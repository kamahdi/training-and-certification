import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

/** 128-bit random token, URL-safe (ADR-004). */
export function newToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Visit and form link tokens are derived from the visit id with a server secret, so a reminder
 * sent days later can carry the link while the database holds only the token's hash.
 * 128 bits, URL-safe.
 */
export function linkToken(visitId: string, purpose: 'visit' | 'form'): string {
  return createHmac('sha256', config.linkSecret).update(`${purpose}:${visitId}`).digest().subarray(0, 16).toString('base64url');
}

/** Hash for tokens, cookies, codes and phone numbers. Only hashes are stored. */
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function fourDigitCode(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

/** Field encryption for form answers: AES-256-GCM, "v1:iv:tag:ciphertext" in base64. */
export function encrypt(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', config.fieldKey, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  const [v, iv, tag, data] = value.split(':');
  if (v !== 'v1') throw new Error('Unknown encryption version');
  const d = createDecipheriv('aes-256-gcm', config.fieldKey, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, key] = stored.split(':');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}
