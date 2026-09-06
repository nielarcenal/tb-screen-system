/**
 * Gateway tests — the ONLY file outside _shared/ that vitest loads, and it is
 * loadable for the reason the runner config states: gateway.ts is pure. It
 * imports nothing, touches no Deno global, and takes its environment as a
 * parameter rather than reading Deno.env itself. index.ts is not testable here
 * and must never be added to the include list.
 *
 * These matter more than most: this module is the last thing between the
 * function and a real SMS on a real patient's phone, and it cannot be
 * exercised in staging without spending live gateway quota.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGateway, toInternationalPH } from './gateway.ts';

/** Stand-in for Deno.env, matching createGateway's structural parameter. */
const env = (vars: Record<string, string>) => ({
  get: (key: string): string | undefined => vars[key],
});

/** Minimal fetch Response stand-in — gateway.ts uses .ok, .status and .text(). */
const reply = (status: number, body = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(body),
});

const TEXTBEE_URL = 'https://api.textbee.dev/api/v1/gateway/send-sms';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('toInternationalPH', () => {
  it('converts the 09XXXXXXXXX form the database stores', () => {
    expect(toInternationalPH('09171234567')).toBe('+639171234567');
  });

  it('leaves an already-international number alone', () => {
    expect(toInternationalPH('+639171234567')).toBe('+639171234567');
  });

  it('adds the missing plus to a 63-prefixed number', () => {
    expect(toInternationalPH('639171234567')).toBe('+639171234567');
  });

  it('adds the country code to a bare 10-digit mobile number', () => {
    expect(toInternationalPH('9171234567')).toBe('+639171234567');
  });

  it('strips spaces, dashes and parentheses before matching', () => {
    expect(toInternationalPH('0917 123-4567')).toBe('+639171234567');
    expect(toInternationalPH('(0917) 123 4567')).toBe('+639171234567');
  });

  it('returns an unrecognised number UNCHANGED rather than guessing', () => {
    // Deliberate: inventing a validation policy here would reject numbers the
    // schema accepts. Let TextBee 400 it and let the error be logged.
    expect(toInternationalPH('12345')).toBe('12345');
    expect(toInternationalPH('not-a-number')).toBe('not-a-number');
  });

  it('does not mangle a non-PH international number', () => {
    expect(toInternationalPH('+12025550123')).toBe('+12025550123');
  });
});

describe('createGateway', () => {
  it('defaults to the stub when SMS_GATEWAY is unset', () => {
    expect(createGateway(env({})).name).toBe('stub');
  });

  it('falls back to the stub when SMS_GATEWAY=textbee but the key is missing', () => {
    // The trap called out for semaphore: setting SMS_GATEWAY alone silently
    // sends nothing. It must log loudly and stub, not throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(createGateway(env({ SMS_GATEWAY: 'textbee' })).name).toBe('stub');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('TEXTBEE_API_KEY is unset'));
  });

  it('selects textbee when the key is present', () => {
    const g = createGateway(env({ SMS_GATEWAY: 'textbee', TEXTBEE_API_KEY: 'k' }));
    expect(g.name).toBe('textbee');
  });

  it('still selects semaphore, unchanged by the added branch', () => {
    const g = createGateway(env({ SMS_GATEWAY: 'semaphore', SEMAPHORE_API_KEY: 'k' }));
    expect(g.name).toBe('semaphore');
  });
});

describe('TextBeeGateway.send', () => {
  const gateway = (vars: Record<string, string> = {}) =>
    createGateway(env({ SMS_GATEWAY: 'textbee', TEXTBEE_API_KEY: 'secret-key', ...vars }));

  it('POSTs the documented shape: x-api-key, JSON, normalised recipients', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, '{"data":{"success":true}}'));
    vi.stubGlobal('fetch', fetchMock);

    await gateway().send('09171234567', 'Health reminder');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TEXTBEE_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('secret-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      message: 'Health reminder',
      recipients: ['+639171234567'],
    });
  });

  it('omits deviceId when TEXTBEE_DEVICE_ID is unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200));
    vi.stubGlobal('fetch', fetchMock);

    await gateway().send('09171234567', 'x');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('deviceId');
  });

  it('includes deviceId when TEXTBEE_DEVICE_ID is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200));
    vi.stubGlobal('fetch', fetchMock);

    await gateway({ TEXTBEE_DEVICE_ID: 'dev-1' }).send('09171234567', 'x');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).deviceId).toBe('dev-1');
  });

  it('sends an abort signal so a hung relay cannot run forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200));
    vi.stubGlobal('fetch', fetchMock);

    await gateway().send('09171234567', 'x');

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('reports sent on 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200)));
    await expect(gateway().send('09171234567', 'x')).resolves.toBe('sent');
  });

  it.each([
    [400, 'no enabled device'],
    [401, 'invalid api key'],
    [429, 'daily limit reached'],
  ])('reports failed and logs the body on HTTP %i', async (status, body) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status, body)));

    await expect(gateway().send('09171234567', 'x')).resolves.toBe('failed');
    // The body is what distinguishes a spent quota from a disabled device, so
    // it has to reach the logs, not just the status.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining(body));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining(String(status)));
  });

  it('reports failed rather than throwing when the request itself errors', async () => {
    // A throw here would escape sendLogged() and strand the reserved sms_log
    // row as 'queued'.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(gateway().send('09171234567', 'x')).resolves.toBe('failed');
  });
});
