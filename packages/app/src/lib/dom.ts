/** Tiny dependency-free DOM helpers. */

type Child = Node | string | null | undefined | false;

interface ElOptions {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  href?: string;
  src?: string;
  type?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
}

/** Create an element with common options and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.title !== undefined) node.title = opts.title;
  if (opts.href !== undefined && 'href' in node) (node as HTMLAnchorElement).href = opts.href;
  if (opts.src !== undefined && 'src' in node) (node as HTMLImageElement).src = opts.src;
  if (opts.type !== undefined && 'type' in node) {
    (node as HTMLInputElement).type = opts.type;
  }
  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = v;
  }
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Remove all children from a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
