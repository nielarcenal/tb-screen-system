/**
 * SMS gateway module (brief §3): SWAPPABLE and STUBBABLE by design.
 *
 * The Edge Function only ever talks to the `SmsGateway` interface. Which
 * implementation runs is picked by the SMS_GATEWAY secret:
 *   - "stub"      (default) — logs instead of sending; delivery_status 'stubbed'.
 *   - "semaphore"           — Philippine gateway https://semaphore.co (v4 API).
 *
 * Swapping providers later = adding one class here; nothing else changes.
 */

/** Matches the sms_log.delivery_status CHECK constraint (minus 'queued'). */
export type SendOutcome = 'sent' | 'failed' | 'stubbed';

export interface SmsGateway {
  readonly name: string;
  send(number: string, message: string): Promise<SendOutcome>;
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

/** Pick the gateway from environment secrets. Unknown/missing config ⇒ stub. */
export function createGateway(env: {
  get(key: string): string | undefined;
}): SmsGateway {
  if (env.get('SMS_GATEWAY') === 'semaphore') {
    const apiKey = env.get('SEMAPHORE_API_KEY');
    if (!apiKey) {
      console.error('[gateway] SMS_GATEWAY=semaphore but SEMAPHORE_API_KEY is unset — using stub.');
      return new StubGateway();
    }
    return new SemaphoreGateway(apiKey, env.get('SEMAPHORE_SENDER_NAME'));
  }
  return new StubGateway();
}
