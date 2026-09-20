/** Device-local lock. No PIN or account password is sent to patient/sync storage. */
export interface PinRecord {
  version: 1;
  ownerId: string;
  salt: string;
  hash: string;
  failures: number;
  retryAt: number;
}

export interface PinDependencies {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  random(): string;
  hash(value: string): Promise<string>;
  authenticate(email: string, password: string): Promise<string | null>;
  now(): number;
}

export class PinError extends Error {
  constructor(public code: 'invalid' | 'wrong' | 'wait' | 'recovery' | 'storage') {
    super(code);
  }
}

export const validPin = (pin: string) => /^\d{6}$/.test(pin);
export const retryDelay = (failures: number) => failures < 5 ? 0 : Math.min(900_000, 30_000 * 2 ** Math.min(failures - 5, 5));

export function parsePinRecord(raw: string | null): PinRecord | null {
  if (raw === null) return null;
  const r = JSON.parse(raw) as PinRecord;
  if (!r || r.version !== 1 || typeof r.ownerId !== 'string' || !r.ownerId ||
      typeof r.salt !== 'string' || !r.salt || !/^[a-f0-9]{64}$/.test(r.hash) ||
      !Number.isSafeInteger(r.failures) || r.failures < 0 ||
      !Number.isSafeInteger(r.retryAt) || r.retryAt < 0) throw new PinError('storage');
  return r;
}

export class PinVault {
  // Serialize attempts: rapid taps must not overwrite the persisted attempt count.
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private deps: PinDependencies) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  async read(): Promise<PinRecord | null> { return parsePinRecord(await this.deps.read()); }
  private async save(pin: string, ownerId: string) {
    if (!validPin(pin) || !ownerId) throw new PinError('invalid');
    const salt = this.deps.random();
    const record: PinRecord = { version: 1, ownerId, salt,
      hash: await this.deps.hash(`${salt}:${pin}`), failures: 0, retryAt: 0 };
    await this.deps.write(JSON.stringify(record));
  }
  setup(pin: string, ownerId: string) {
    return this.serial(async () => {
      if (await this.read()) throw new PinError('storage');
      await this.save(pin, ownerId);
    });
  }
  private async check(pin: string): Promise<PinRecord> {
    const record = await this.read();
    if (!record) throw new PinError('storage');
    if (record.retryAt > this.deps.now()) throw new PinError('wait');
    const hash = await this.deps.hash(`${record.salt}:${pin}`);
    let difference = hash.length ^ record.hash.length;
    for (let i = 0; i < record.hash.length; i++) difference |= record.hash.charCodeAt(i) ^ (hash.charCodeAt(i) || 0);
    if (!validPin(pin) || difference !== 0) {
      const failures = Math.min(record.failures + 1, 100);
      await this.deps.write(JSON.stringify({ ...record, failures,
        retryAt: this.deps.now() + retryDelay(failures) }));
      throw new PinError('wrong');
    }
    return record;
  }
  unlock(pin: string) {
    return this.serial(async () => {
      const record = await this.check(pin);
      await this.deps.write(JSON.stringify({ ...record, failures: 0, retryAt: 0 }));
    });
  }
  change(oldPin: string, newPin: string) {
    return this.serial(async () => {
      if (!validPin(newPin)) throw new PinError('invalid');
      const record = await this.check(oldPin);
      await this.save(newPin, record.ownerId);
    });
  }
  recover(email: string, password: string, newPin: string) {
    return this.serial(async () => {
      if (!validPin(newPin)) throw new PinError('invalid');
      const record = await this.read();
      if (!record) throw new PinError('storage');
      // A fresh online authentication must prove the original PIN owner's identity.
      // Never use a cached session, and never delete local data to reset a PIN.
      const ownerId = await this.deps.authenticate(email, password);
      if (!ownerId || ownerId !== record.ownerId) throw new PinError('recovery');
      await this.save(newPin, ownerId);
    });
  }
}
