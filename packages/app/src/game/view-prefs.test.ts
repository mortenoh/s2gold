import { describe, expect, it } from 'vitest';
import { graphicsLabel, graphicsScale, nextGraphicsPref } from './view-prefs';

describe('graphics preference', () => {
  it('resolves Auto by screen density and forces the explicit choices', () => {
    expect(graphicsScale('auto', 1)).toBe(1);
    expect(graphicsScale('auto', 1.25)).toBe(1);
    expect(graphicsScale('auto', 1.5)).toBe(2);
    expect(graphicsScale('auto', 2)).toBe(2);
    expect(graphicsScale('original', 2)).toBe(1);
    expect(graphicsScale('hd', 1)).toBe(2);
  });

  it('cycles Auto, Original, HD and labels the resolved set', () => {
    expect(nextGraphicsPref('auto')).toBe('original');
    expect(nextGraphicsPref('original')).toBe('hd');
    expect(nextGraphicsPref('hd')).toBe('auto');
    expect(graphicsLabel('auto', 2)).toBe('Graphics: Auto (HD)');
    expect(graphicsLabel('auto', 1)).toBe('Graphics: Auto (Original)');
    expect(graphicsLabel('hd', 1)).toBe('Graphics: HD');
  });
});
