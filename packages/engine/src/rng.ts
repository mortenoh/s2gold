/**
 * PCG32 pseudo-random generator with fully serializable integer state.
 *
 * PCG (O'Neill 2014) is a small, well-distributed generator. State is two
 * 64-bit integers held as BigInt; serialization keeps them as decimal strings
 * so no floats ever enter the world state. Every draw mutates the state in
 * place and returns a 32-bit unsigned integer.
 */

const MASK64 = (1n << 64n) - 1n;
const MULT = 6364136223846793005n;
const DEFAULT_INC = 1442695040888963407n;

/** Serializable RNG state. `state` advances; `inc` is the fixed stream id. */
export interface RngState {
  state: string;
  inc: string;
}

interface Internal {
  state: bigint;
  inc: bigint;
}

function load(s: RngState): Internal {
  return { state: BigInt(s.state) & MASK64, inc: BigInt(s.inc) & MASK64 };
}

function store(i: Internal): RngState {
  return { state: i.state.toString(), inc: i.inc.toString() };
}

function step(i: Internal): number {
  const old = i.state;
  i.state = (old * MULT + i.inc) & MASK64;
  const xorshifted = (((old >> 18n) ^ old) >> 27n) & 0xffffffffn;
  const rot = Number(old >> 59n);
  const x = Number(xorshifted) >>> 0;
  return ((x >>> rot) | (x << ((-rot >>> 0) & 31))) >>> 0;
}

/** Create RNG state from a numeric seed and optional stream sequence id. */
export function seedRng(seed: number, seq = 0): RngState {
  const inc = ((BigInt(seq >>> 0) << 1n) | 1n) & MASK64 || DEFAULT_INC;
  const i: Internal = { state: 0n, inc };
  step(i);
  i.state = (i.state + (BigInt(seed >>> 0) & MASK64)) & MASK64;
  step(i);
  return store(i);
}

/** Draw the next 32-bit unsigned integer, mutating `s` in place. */
export function nextUint(s: RngState): number {
  const i = load(s);
  const v = step(i);
  const stored = store(i);
  s.state = stored.state;
  s.inc = stored.inc;
  return v;
}

/** Draw an integer in [0, bound) with rejection sampling (bound must be > 0). */
export function nextRange(s: RngState, bound: number): number {
  if (bound <= 0) throw new Error('nextRange bound must be positive');
  const b = bound >>> 0;
  const threshold = (0x100000000 % b) >>> 0;
  for (;;) {
    const r = nextUint(s);
    if (r >= threshold) return r % b;
  }
}

/** Deep-copy RNG state (for tests / speculative draws). */
export function cloneRng(s: RngState): RngState {
  return { state: s.state, inc: s.inc };
}
