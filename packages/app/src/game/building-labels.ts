/** Display names for building types (shared by the context menu and panels). */

export const BUILDING_LABEL: Readonly<Record<string, string>> = {
  woodcutter: 'Woodcutter',
  forester: 'Forester',
  quarry: 'Quarry',
  fishery: 'Fishery',
  well: 'Well',
  hunter: 'Hunter',
  lookout: 'Lookout tower',
  sawmill: 'Sawmill',
  mill: 'Mill',
  bakery: 'Bakery',
  slaughterhouse: 'Slaughterhouse',
  brewery: 'Brewery',
  ironsmelter: 'Iron smelter',
  armory: 'Armory',
  metalworks: 'Metalworks',
  mint: 'Mint',
  storehouse: 'Storehouse',
  harbor: 'Harbor',
  shipyard: 'Shipyard',
  farm: 'Farm',
  pigfarm: 'Pig farm',
  donkeybreeder: 'Donkey breeder',
  coalmine: 'Coal mine',
  ironmine: 'Iron mine',
  goldmine: 'Gold mine',
  granitemine: 'Granite mine',
};

/** Display name for a building type. */
export function buildingLabel(type: string): string {
  return (
    BUILDING_LABEL[type] ??
    type.replace(/(^|_)([a-z])/g, (_m, _p: string, c: string) => c.toUpperCase())
  );
}
