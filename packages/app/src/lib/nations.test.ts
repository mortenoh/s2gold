import { describe, expect, it } from 'vitest';
import type { Nation } from '@s2gold/engine';
import {
  decodeNations,
  defaultAiNation,
  encodeNations,
  isAllRoman,
  nationLabel,
  NATION_CODES,
} from './nations';

describe('nation codec', () => {
  it('round-trips a slot-indexed nation list through encode/decode', () => {
    const nations: Nation[] = ['romans', 'vikings', 'nubians', 'japanese'];
    expect(encodeNations(nations)).toBe('rom,vik,nub,jap');
    expect(decodeNations(encodeNations(nations))).toEqual(nations);
  });

  it('decodes an absent/empty value to an empty (all-Roman) list', () => {
    expect(decodeNations(null)).toEqual([]);
    expect(decodeNations(undefined)).toEqual([]);
    expect(decodeNations('')).toEqual([]);
  });

  it('falls back to romans for unknown codes so a bad URL never throws', () => {
    expect(decodeNations('vik,zzz,jap')).toEqual(['vikings', 'romans', 'japanese']);
  });

  it('has a code for every nation and title-cased labels', () => {
    expect(NATION_CODES.romans).toBe('rom');
    expect(nationLabel('vikings')).toBe('Vikings');
  });

  it('assigns opponents varied nations in slot order, wrapping', () => {
    expect([0, 1, 2, 3].map(defaultAiNation)).toEqual([
      'vikings',
      'nubians',
      'japanese',
      'vikings',
    ]);
  });

  it('detects an all-Roman list', () => {
    expect(isAllRoman(['romans', 'romans'])).toBe(true);
    expect(isAllRoman(['romans', 'vikings'])).toBe(false);
  });
});
