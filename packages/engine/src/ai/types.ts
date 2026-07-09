/**
 * Shared types for the deterministic computer opponent (P6).
 *
 * The AI is a pure decision function over world state plus its own serializable
 * `AiState` (a small RNG stream for cadence jitter, decision timing, and a couple
 * of bounded caches). It never mutates the world directly — it returns engine
 * {@link CommandInput}s that the normal command layer validates and applies, so an
 * AI player is indistinguishable from a human at the command boundary and can
 * never emit state the command layer would not accept.
 */

import type { RngState } from '../rng';

/** Tunable knobs for an AI player (all optional; sane defaults in createAiState). */
export interface AiOptions {
  /** Base ticks between decision cycles (jittered by the AI RNG). Default 12. */
  decideInterval?: number;
  /** Independent RNG seed for cadence jitter / tie-breaking. Default derived. */
  seed?: number;
  /** Max road length (lattice steps) the AI will lay to connect one flag. Default 12. */
  maxRoadLength?: number;
  /** Cap on military buildings the AI pushes toward the frontier. Default 4. */
  maxMilitary?: number;
}

/**
 * Serializable per-player AI state. Held outside the World (the World stays a
 * pure sim), reconstructed identically from the same seed so two AI-enabled runs
 * of the same map produce identical command streams (determinism).
 */
export interface AiState {
  /** Player index this AI controls. */
  playerId: number;
  /** Private RNG stream (does not touch the world RNG). */
  rng: RngState;
  /** Base decision cadence in ticks. */
  decideInterval: number;
  /** Next tick at which the AI will run a decision cycle. */
  nextDecisionTick: number;
  /** Max road length the AI lays per connection attempt. */
  maxRoadLength: number;
  /** Cap on frontier military buildings. */
  maxMilitary: number;
  /** flagId -> number of road-connect attempts made (self-heals stuck flags). */
  roadAttempts: Record<number, number>;
  /** buildingId -> last coin-enable state the AI issued (avoids redundant toggles). */
  coinsSet: Record<number, boolean>;
}
