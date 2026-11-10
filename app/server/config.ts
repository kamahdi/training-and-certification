function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const isProduction = () => process.env.NODE_ENV === 'production';

/** Development-only fallbacks so server, worker and tests agree. Production must set real secrets. */
const DEV_FIELD_KEY = Buffer.alloc(32, 7).toString('base64');
const DEV_LINK_SECRET = 'development-only-link-secret';

function secret(name: string, devValue: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProduction()) throw new Error(`${name} is required in production`);
  return devValue;
}

export const config = {
  get databaseUrl() {
    return env('DATABASE_URL', 'postgres://clinic:clinic@localhost:5432/clinic_dev');
  },
  get port() {
    return Number(env('PORT', '3000'));
  },
  get publicUrl() {
    return env('PUBLIC_URL', 'http://localhost:5173');
  },
  get smsProvider() {
    return env('SMS_PROVIDER', 'fake');
  },
  /** 32-byte key for field encryption of form answers. */
  get fieldKey(): Buffer {
    const key = Buffer.from(secret('FIELD_ENCRYPTION_KEY', DEV_FIELD_KEY), 'base64');
    if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64');
    return key;
  },
  /** Secret that derives visit and form link tokens (ADR-004); only hashes of tokens are stored. */
  get linkSecret(): string {
    return secret('LINK_SECRET', DEV_LINK_SECRET);
  },
};
