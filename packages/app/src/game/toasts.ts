/**
 * Transient feedback toasts (save/load confirmations, seafaring events). Each
 * maker owns one visible toast: showing a new message replaces the previous
 * one and restarts the auto-dismiss timer, so rapid events never stack.
 */

import { el } from '../lib/dom';

export type Toast = (text: string) => void;

export interface ToastOptions {
  /** Extra class on top of `.status-toast` (positions the toast lane). */
  className: string;
  /** Auto-dismiss delay in milliseconds. */
  ms: number;
  /** Optional data-testid for e2e assertions. */
  testid?: string;
}

/** A toast function appending into `root` with the given look and lifetime. */
export function makeToast(root: HTMLElement, opts: ToastOptions): Toast {
  let current: HTMLElement | null = null;
  let timer = 0;
  return (text: string): void => {
    if (current) current.remove();
    const toast = el('div', {
      class: `status-toast ${opts.className}`,
      text,
      ...(opts.testid ? { attrs: { 'data-testid': opts.testid } } : {}),
    });
    root.append(toast);
    current = toast;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      toast.remove();
      if (current === toast) current = null;
    }, opts.ms);
  };
}
