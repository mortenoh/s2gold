/** Shared types and defensive extraction helpers for the asset inspector. */

export type Json = unknown;

/** Narrow to a plain record. */
export function isRecord(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read a string field from a record, checking several candidate keys. */
export function pickString(v: Json, ...keys: string[]): string | undefined {
  if (!isRecord(v)) return undefined;
  for (const k of keys) {
    const val = v[k];
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
  }
  return undefined;
}

/** Read a number field from a record, checking several candidate keys. */
export function pickNumber(v: Json, ...keys: string[]): number | undefined {
  if (!isRecord(v)) return undefined;
  for (const k of keys) {
    const val = v[k];
    if (typeof val === 'number') return val;
    if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) {
      return Number(val);
    }
  }
  return undefined;
}

/** Read an array field from a record, checking several candidate keys. */
export function pickArray(v: Json, ...keys: string[]): Json[] | undefined {
  if (!isRecord(v)) return undefined;
  for (const k of keys) {
    const val = v[k];
    if (Array.isArray(val)) return val;
  }
  return undefined;
}

/**
 * Recursively collect all string values within a JSON value that satisfy a
 * predicate. Used to discover filenames when the exact manifest shape is
 * unknown.
 */
export function collectStrings(
  v: Json,
  pred: (s: string) => boolean,
  out: string[] = [],
): string[] {
  if (typeof v === 'string') {
    if (pred(v)) out.push(v);
  } else if (Array.isArray(v)) {
    for (const item of v) collectStrings(item, pred, out);
  } else if (isRecord(v)) {
    for (const val of Object.values(v)) collectStrings(val, pred, out);
  }
  return out;
}

/** Unique, order-preserving. */
export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
