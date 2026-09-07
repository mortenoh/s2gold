import { describe, expect, it } from 'vitest';

import { WinTracker, type CampaignWorldView } from './campaign-data';

function view(over: Partial<CampaignWorldView>): CampaignWorldView {
  return {
    playerCount: 1,
    buildingsOf: () => 0,
    completedBuildingsOf: () => 0,
    ownedLandOf: () => 0,
    ...over,
  };
}

describe('WinTracker buildings goal', () => {
  it('ignores construction sites and counts finished buildings only', () => {
    const tracker = new WinTracker({ kind: 'buildings', count: 10 });
    // HQ + nine sites: the live count is 10 but only the HQ is finished.
    const sitesOnly = tracker.evaluate(
      view({ buildingsOf: () => 10, completedBuildingsOf: () => 1 }),
    );
    expect(sitesOnly.done).toBe(false);
    expect(sitesOnly.progress).toBe('1 / 10 buildings');

    const finished = tracker.evaluate(
      view({ buildingsOf: () => 12, completedBuildingsOf: () => 10 }),
    );
    expect(finished.done).toBe(true);
    expect(finished.progress).toBe('10 / 10 buildings');
  });
});
