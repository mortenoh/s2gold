import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, version } from './index';

describe('@s2gold/engine', () => {
  it('exposes a version string', () => {
    expect(version()).toBe(ENGINE_VERSION);
    expect(typeof ENGINE_VERSION).toBe('string');
  });
});
