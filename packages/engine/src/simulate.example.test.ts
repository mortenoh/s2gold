import { describe, expect, it } from 'vitest';
import { runSimulation } from '../scripts/simulate';

/**
 * Example / manual-inspection harness. Not an assertion-heavy test — it runs the
 * demo economy for a short while and prints the tick-by-tick summary so a human
 * can eyeball pacing. Also doubles as a smoke test that the CLI routine runs.
 */
describe('simulate example', () => {
  it('prints a tick-by-tick economy summary', () => {
    const lines: string[] = [];
    runSimulation(400, 100, (line) => {
      lines.push(line);
      console.log(line);
    });
    expect(lines.length).toBeGreaterThan(1);
  });
});
