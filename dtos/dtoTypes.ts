export type UnknownRecord = Record<string, unknown>;

export const asRecord = (value: unknown): UnknownRecord | null => (
  typeof value === 'object' && value !== null
    ? value as UnknownRecord
    : null
);

export const toPlainRecord = (value: unknown): UnknownRecord | null => {
  const source = asRecord(value);
  if (!source) return null;

  const toObject = source.toObject;
  if (typeof toObject !== 'function') return source;

  return asRecord(toObject.call(value));
};

export const toId = (value: unknown): string | null => {
  if (!value) return null;
  const source = asRecord(value);
  return String(source?._id ?? value);
};

export const toIsoDate = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : typeof value === 'string' || typeof value === 'number'
      ? new Date(value)
      : null;

  return !date || Number.isNaN(date.getTime()) ? null : date.toISOString();
};
