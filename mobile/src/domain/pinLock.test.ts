import { describe, expect, it } from 'vitest';
import { parsePinRecord, PinVault, retryDelay, validPin } from './pinLock';

function fixture() {
  let raw: string | null = null;
  let now = 100_000;
  let storageFails = false;
  let authUser: string | null = 'owner';
  let salt = 0;
  const deps = {
    read: async () => raw,
    write: async (value: string) => { if (storageFails) throw new Error('disk'); raw = value; },
    random: () => `salt-${++salt}`,
    // Deterministic test double; production uses Expo Crypto SHA-256.
    hash: async (value: string) => Array.from(value, (c) => c.charCodeAt(0).toString(16)).join('').padEnd(64, '0'),
    now: () => now,
    authenticate: async () => authUser,
  };
  return { vault: new PinVault(deps), deps, raw: () => raw,
    advance: (ms: number) => { now += ms; }, failWrites: () => { storageFails = true; },
    authAs: (id: string | null) => { authUser = id; } };
}

describe('device PIN vault', () => {
  it('only accepts exactly six ASCII digits, retaining leading zeros', () => {
    expect(validPin('001234')).toBe(true);
    for (const pin of ['', '1234', '1234567', 'abcdef', '１２３４５６', '12345 ']) expect(validPin(pin)).toBe(false);
  });
  it('does not treat corrupt or unsupported storage as an unconfigured PIN', () => {
    expect(parsePinRecord(null)).toBeNull();
    for (const raw of ['{}', 'null', '{', '{"version":2}']) expect(() => parsePinRecord(raw)).toThrow();
  });
  it('stores a salted hash, never a plaintext PIN', async () => {
    const f = fixture(); await f.vault.setup('001234', 'owner');
    expect(f.raw()).not.toContain('001234');
    expect((await f.vault.read())?.hash).toHaveLength(64);
    await expect(f.vault.unlock('001234')).resolves.toBeUndefined();
  });
  it('never overwrites an existing PIN through setup', async () => {
    const f = fixture(); await f.vault.setup('123456', 'owner');
    await expect(f.vault.setup('654321', 'other')).rejects.toThrow();
    await expect(f.vault.unlock('123456')).resolves.toBeUndefined();
  });
  it('persists the cooldown across restarts and rejects even correct PIN during cooldown', async () => {
    const f = fixture(); await f.vault.setup('123456', 'owner');
    for (let i = 0; i < 5; i++) await expect(f.vault.unlock('000000')).rejects.toMatchObject({ code: 'wrong' });
    const restarted = new PinVault(f.deps);
    await expect(restarted.unlock('123456')).rejects.toMatchObject({ code: 'wait' });
    f.advance(30_000);
    await restarted.unlock('123456');
    expect(await restarted.read()).toMatchObject({ failures: 0, retryAt: 0 });
  });
  it('serializes simultaneous guesses so the cooldown cannot be skipped by double taps', async () => {
    const f = fixture(); await f.vault.setup('123456', 'owner');
    await Promise.allSettled(Array.from({ length: 12 }, () => f.vault.unlock('000000')));
    expect((await f.vault.read())?.failures).toBe(5);
  });
  it('escalates the retry delay with a fifteen-minute cap', () => {
    expect(retryDelay(4)).toBe(0); expect(retryDelay(5)).toBe(30_000);
    expect(retryDelay(6)).toBe(60_000); expect(retryDelay(100)).toBe(900_000);
  });
  it('requires the current PIN to change it and rotates the salt', async () => {
    const f = fixture(); await f.vault.setup('123456', 'owner');
    const before = await f.vault.read();
    await expect(f.vault.change('000000', '654321')).rejects.toThrow();
    await f.vault.change('123456', '654321');
    expect((await f.vault.read())?.salt).not.toBe(before?.salt);
    await expect(f.vault.unlock('123456')).rejects.toThrow();
    await expect(f.vault.unlock('654321')).resolves.toBeUndefined();
  });
  it('fails closed when writing a verified unlock fails', async () => {
    const f = fixture(); await f.vault.setup('123456', 'owner'); f.failWrites();
    await expect(f.vault.unlock('123456')).rejects.toThrow('disk');
  });
  it('failed setup does not create a usable PIN', async () => {
    const f = fixture(); f.failWrites();
    await expect(f.vault.setup('123456', 'owner')).rejects.toThrow();
    expect(await f.vault.read()).toBeNull();
  });
  it('rejects recovery by another valid account or a failed login', async () => {
    const f = fixture(); await f.vault.setup('123456', 'owner');
    for (const id of ['other', null]) {
      f.authAs(id);
      await expect(f.vault.recover('email', 'password', '654321')).rejects.toMatchObject({ code: 'recovery' });
    }
    await expect(f.vault.unlock('123456')).resolves.toBeUndefined();
  });
  it('recovers with fresh owner authentication without removing records', async () => {
    const f = fixture(); await f.vault.setup('123456', 'owner');
    await f.vault.recover('email', 'password', '654321');
    expect(await f.vault.read()).toMatchObject({ ownerId: 'owner', failures: 0 });
    expect(f.raw()).not.toContain('password');
    await expect(f.vault.unlock('654321')).resolves.toBeUndefined();
  });
});
