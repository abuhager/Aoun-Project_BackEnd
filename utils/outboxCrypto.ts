import crypto from 'node:crypto';

const KEY_BYTES = 32;

const decodeConfiguredKey = (value: string): Buffer | null => {
  const normalized = value.trim();
  if (/^[a-f\d]{64}$/i.test(normalized)) return Buffer.from(normalized, 'hex');

  try {
    const decoded = Buffer.from(normalized, 'base64');
    return decoded.length === KEY_BYTES ? decoded : null;
  } catch {
    return null;
  }
};

const getOutboxKey = (): Buffer => {
  const configured = process.env.OUTBOX_ENCRYPTION_KEY;
  if (configured) {
    const decoded = decodeConfiguredKey(configured);
    if (!decoded) {
      throw new Error('OUTBOX_ENCRYPTION_KEY يجب أن يكون 32 بايت بصيغة base64 أو 64 خانة hex');
    }
    return decoded;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('OUTBOX_ENCRYPTION_KEY مطلوب في production');
  }

  // مفتاح deterministic للاختبار/التطوير فقط كي لا تُخزن الأسرار كنص صريح.
  return crypto.createHash('sha256')
    .update(`aoun-outbox:${process.env.JWT_SECRET ?? 'local-development-only'}`)
    .digest();
};

export const encryptOutboxPayload = (payload: unknown): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getOutboxKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
};

export const decryptOutboxPayload = <T>(value: string): T => {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('OUTBOX_PAYLOAD_INVALID');
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getOutboxKey(),
      Buffer.from(ivValue, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    throw new Error('OUTBOX_PAYLOAD_DECRYPT_FAILED');
  }
};

export const isValidOutboxEncryptionKey = (value: string | undefined): boolean => (
  Boolean(value && decodeConfiguredKey(value))
);
