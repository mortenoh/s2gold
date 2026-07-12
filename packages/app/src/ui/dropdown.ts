/**
 * Compact custom dropdown for the in-game HUD.
 *
 * Native select popups render with the OS system font (huge next to the 12px
 * HUD) and ignore CSS, so this replaces them with a styled button + listbox.
 * Keyboard: Enter/Space/ArrowDown open, arrows move, Enter selects, Esc closes.
 */

export interface DropdownOption {
  value: string;
  label: string;
}

export interface Dropdown {
  element: HTMLElement;
  /** Currently selected value. */
  value: string;
  /** Programmatically select a value (no change event fired). */
  setValue(value: string): void;
  /** Replace the option list, keeping the selection when still present. */
  setOptions(options: DropdownOption[]): void;
}

export function createDropdown(
  options: DropdownOption[],
  initial: string,
  onChange: (value: string) => void,
  attrs?: Record<string, string>,
): Dropdown {
  let opts = options.slice();
  let value = initial;
  let open = false;
  let highlighted = 0;

  const root = document.createElement('span');
  root.className = 'dropdown';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dropdown-button';
  button.setAttribute('aria-haspopup', 'listbox');
  for (const [k, v] of Object.entries(attrs ?? {})) button.setAttribute(k, v);
  const list = document.createElement('ul');
  list.className = 'dropdown-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  root.append(button, list);

  const labelFor = (v: string): string => opts.find((o) => o.value === v)?.label ?? v;

  function renderButton(): void {
    button.textContent = labelFor(value);
    button.title = labelFor(value);
  }

  function renderList(): void {
    list.textContent = '';
    opts.forEach((o, i) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.dataset.value = o.value;
      item.textContent = o.label;
      item.className =
        (o.value === value ? 'selected ' : '') + (i === highlighted ? 'highlighted' : '');
      item.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        choose(o.value);
      });
      list.append(item);
    });
  }

  function setOpen(next: boolean): void {
    open = next;
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      const rect = button.getBoundingClientRect();
      list.style.left = `${rect.left}px`;
      // Open upward when the button sits in the lower half of the viewport
      // (the HUD bar is bottom-anchored), so the popup stays on-screen.
      highlighted = Math.max(
        0,
        opts.findIndex((o) => o.value === value),
      );
      renderList();
      if (rect.top > window.innerHeight / 2) {
        list.style.top = 'auto';
        list.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      } else {
        list.style.bottom = 'auto';
        list.style.top = `${rect.bottom + 4}px`;
      }
      list.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' });
    }
  }

  function choose(v: string): void {
    const changed = v !== value;
    value = v;
    dropdown.value = v;
    renderButton();
    setOpen(false);
    if (changed) onChange(v);
  }

  button.addEventListener('click', () => setOpen(!open));
  button.addEventListener('keydown', (ev) => {
    if (!open && (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      setOpen(false);
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const delta = ev.key === 'ArrowDown' ? 1 : -1;
      highlighted = Math.min(opts.length - 1, Math.max(0, highlighted + delta));
      renderList();
      list.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const target = opts[highlighted];
      if (target) choose(target.value);
    }
  });
  document.addEventListener('pointerdown', (ev) => {
    if (open && !root.contains(ev.target as Node)) setOpen(false);
  });

  const dropdown: Dropdown = {
    element: root,
    value,
    setValue(v: string): void {
      value = v;
      dropdown.value = v;
      renderButton();
    },
    setOptions(next: DropdownOption[]): void {
      opts = next.slice();
      if (!opts.some((o) => o.value === value) && opts[0]) {
        value = opts[0].value;
        dropdown.value = value;
      }
      renderButton();
      if (open) renderList();
    },
  };
  renderButton();
  return dropdown;
}
