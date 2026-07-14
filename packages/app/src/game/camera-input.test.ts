import { describe, expect, it } from 'vitest';
import { isEditableTarget } from './camera-input';

/**
 * Guards the global game shortcuts (pan/zoom/pause) against firing while the user
 * is typing in the save-name text input or the attack-count number input. The
 * helper is duck-typed on the event target so it runs without a real DOM.
 */
const target = (o: { tagName?: string; isContentEditable?: boolean }): EventTarget =>
  o as unknown as EventTarget;

describe('isEditableTarget', () => {
  it('flags text and number inputs (save-name, attack-count)', () => {
    expect(isEditableTarget(target({ tagName: 'INPUT' }))).toBe(true);
  });

  it('flags textarea and select', () => {
    expect(isEditableTarget(target({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(isEditableTarget(target({ tagName: 'SELECT' }))).toBe(true);
  });

  it('flags contenteditable elements', () => {
    expect(isEditableTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  it('accepts lowercase tagName (defensive)', () => {
    expect(isEditableTarget(target({ tagName: 'input' }))).toBe(true);
  });

  it('ignores non-editable elements and non-elements', () => {
    expect(isEditableTarget(target({ tagName: 'CANVAS' }))).toBe(false);
    expect(isEditableTarget(target({ tagName: 'DIV', isContentEditable: false }))).toBe(false);
    expect(isEditableTarget(target({ tagName: 'BUTTON' }))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    // window/document targets have no tagName.
    expect(isEditableTarget(target({}))).toBe(false);
  });
});
