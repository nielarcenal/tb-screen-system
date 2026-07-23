import * as Crypto from 'expo-crypto';

/** RFC-4122 v4 UUID generated on-device (works fully offline). */
export function uuid(): string {
  return Crypto.randomUUID();
}

/** Current instant as a UTC ISO-8601 string — the timestamp format we store. */
export function nowIso(): string {
  return new Date().toISOString();
}
