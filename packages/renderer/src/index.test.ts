import { describe, expect, it } from 'vitest';
import { RENDERER_VERSION, version } from './index';

describe('@s2gold/renderer', () => {
  it('exposes a version string', () => {
    expect(version()).toBe(RENDERER_VERSION);
    expect(typeof RENDERER_VERSION).toBe('string');
  });
});
