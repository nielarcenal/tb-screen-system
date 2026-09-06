/**
 * SMS gateway module (brief §3): SWAPPABLE and STUBBABLE by design.
 *
 * The Edge Function only ever talks to the `SmsGateway` interface. Which
 * implementation runs is picked by the SMS_GATEWAY secret:
 *   - "stub"      (default) — logs instead of sending; delivery_status 'stubbed'.
 *   - "semaphore"           — Philippine gateway https://semaphore.co (v4 API).
 *   - "textbee"             — https://textbee.dev; relays through an Android
 *                             phone sending on its own SIM. No sender name to
 *                             register, so it has no equivalent of the approval
 *                             that currently blocks the semaphore path.
 *
 * Swapping providers later = adding one class here; nothing else changes.
 *
 * WHAT 'sent' MEANS. Every gateway reports 'sent' when the provider ACCEPTED
 * the message, not when a handset received it. That gap is widest for textbee,
 * which only queues to a phone that must be awake, online and in signal to
 * transmit at all. The reminder path in index.ts does not retry, so read 'sent'
 * as "handed off" and never as "delivered".
 */

/** Matches the sms_log.delivery_status CHECK constraint (minus 'queued'). */
export type SendOutcome = 'sent' | 'failed' | 'stubbed';

export interface SmsGateway {
  readonly name: string;
  send(number: string, message: string): Promise<SendOutcome>;
}

/**
 * TextBee requires recipients "in international format". The database stores
 * Philippine mobile numbers as `09XXXXXXXXX` — the form Semaphore accepts and
 * is handed verbatim — so that shape has to be converted for this gateway only.
 *
 * Converts the shapes we can recognise and returns anything else UNCHANGED:
 * this module is not the place to invent a validation policy the schema does
 * not have. An unrecognised number reaches TextBee as-is and comes back 400,
 * which is logged with its body.
 */
export function toInternationalPH(number: string): string {
  const digits = number.replace(/[\s()-]/g, '');
  if (digits.startsWith('+')) return digits; // already international
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return number;
}

/** Development/default gateway: never sends, only logs. */
class StubGateway implements SmsGateway {
  readonly name = 'stub';

  send(number: string, message: string): Promise<SendOutcome> {
    // Mask most of the number in logs — function logs are not a PHI store.
    const masked = number.slice(0, 4) + '*'.repeat(Math.max(number.length - 4, 0));
    console.log(`[stub-sms] would send to ${masked}: ${message}`);
    return Promise.resolve('stubbed');
  }
}

/** Semaphore (https://semaphore.co) — Philippine SMS gateway, v4 REST API. */
class SemaphoreGateway implements SmsGateway {
  readonly name = 'semaphore';

  constructor(
    private apiKey: string,
    private senderName: string | undefined,
  ) {}

  async send(number: string, message: string): Promise<SendOutcome> {
    const body = new URLSearchParams({ apikey: this.apiKey, number, message });
    if (this.senderName) body.set('sendername', this.senderName);

    try {
      const res = await fetch('https://api.semaphore.co/api/v4/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        console.error(`[semaphore] HTTP ${res.status}: ${await res.text()}`);
        return 'failed';
      }
      return 'sent';
    } catch (e) {
      console.error(`[semaphore] request error: ${e instanceof Error ? e.message : e}`);
      return 'failed';
    }
  }
}

/**
 * TextBee (https://textbee.dev) — an Android phone you own acts as the modem;
 * their cloud relays the message to it and the phone sends over its own SIM.
 *
 * The account-level endpoint is used deliberately. The older per-device route
 * `/gateway/devices/{deviceId}/send-sms` still works but is DEPRECATED.
 */
class TextBeeGateway implements SmsGateway {
  readonly name = 'textbee';

  /**
   * A relay to a phone can stall in ways a carrier API does not. Bound it so a
   * hung request cannot eat the function's wall clock: the send is already
   * reserved in sms_log, and a run that dies mid-send leaves a 'queued' row
   * that staleQueuedCutoff() reclaims on a later run.
   */
  private static readonly TIMEOUT_MS = 15_000;

  constructor(
    private apiKey: string,
    private deviceId: string | undefined,
  ) {}

  async send(number: string, message: string): Promise<SendOutcome> {
    const payload: Record<string, unknown> = {
      message,
      recipients: [toInternationalPH(number)],
    };
    // Optional: with a single active device TextBee picks it. Set
    // TEXTBEE_DEVICE_ID once a second device is registered, or sends land on
    // whichever phone the account saw most recently.
    if (this.deviceId) payload.deviceId = this.deviceId;

    try {
      const res = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TextBeeGateway.TIMEOUT_MS),
      });
      if (!res.ok) {
        // 401 (bad/revoked key) and 400 (no enabled device, device disabled,
        // email unverified) are PERMANENT config errors; 429 means a spent
        // daily/monthly quota. The status is LOGGED, not classified into
        // retryable/permanent — same reasoning as the flat FOLLOWUP_MAX_ATTEMPTS
        // cap in index.ts, and the same trap Semaphore's HTTP 500 for a
        // permanent error would have sprung.
        console.error(`[textbee] HTTP ${res.status}: ${await res.text()}`);
        return 'failed';
      }
      // 200 carries { success, smsBatchId, recipientCount }. smsBatchId would
      // let a caller poll real delivery; this function does not track it, so
      // acceptance is as far as the outcome goes.
      return 'sent';
    } catch (e) {
      // Includes the AbortSignal timeout, which surfaces as a TimeoutError.
      console.error(`[textbee] request error: ${e instanceof Error ? e.message : e}`);
      return 'failed';
    }
  }
}

/** Pick the gateway from environment secrets. Unknown/missing config ⇒ stub. */
export function createGateway(env: {
  get(key: string): string | undefined;
}): SmsGateway {
  switch (env.get('SMS_GATEWAY')) {
    case 'semaphore': {
      const apiKey = env.get('SEMAPHORE_API_KEY');
      if (!apiKey) {
        console.error('[gateway] SMS_GATEWAY=semaphore but SEMAPHORE_API_KEY is unset — using stub.');
        return new StubGateway();
      }
      return new SemaphoreGateway(apiKey, env.get('SEMAPHORE_SENDER_NAME'));
    }
    case 'textbee': {
      const apiKey = env.get('TEXTBEE_API_KEY');
      if (!apiKey) {
        console.error('[gateway] SMS_GATEWAY=textbee but TEXTBEE_API_KEY is unset — using stub.');
        return new StubGateway();
      }
      return new TextBeeGateway(apiKey, env.get('TEXTBEE_DEVICE_ID'));
    }
    default:
      return new StubGateway();
  }
}
