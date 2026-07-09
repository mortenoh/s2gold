# Map objects & resource encodings (facts, cited)

Runtime and map-file encodings for terrain-node objects and subsurface resources.
Sources: **settlers2.net** documentation (`/documentation/objects/`,
`/documentation/world-map-file-format-wldswd/`), and **RttR** runtime enums
(`gameTypes/Resource.h`, `nodeObjs/noBase.h` BlockingManner, `nodeObjs/noTree.*`,
`nodeObjs/noGrainfield.cpp`, `figures/nofForester.cpp`, `figures/nofWoodcutter.cpp`).

There are **two distinct encodings** to keep separate:
1. **WLD/SWD map-file bytes** — read once by the map loader (settlers2.net tables §2, §5).
2. **Runtime node state** — what the sim/engine stores per node (RttR enums; authoritative
   for our engine's world model). The loader translates (1) -> (2).

---

## 1. Runtime node-object blocking (build interaction)

Source `nodeObjs/noBase.h` enum `BlockingManner` — decides how an object affects building
quality (BQ) on and around its node:

| BlockingManner | Meaning | Buildable on node? | Around it |
|----------------|---------|:--:|-----------|
| None | decorative, can be removed | yes (auto-removed) | no restriction |
| Single | blocks only its own node | no | build allowed on neighbours |
| Tree | passable by figures | no | **only huts** allowed adjacent |
| FlagsAround | e.g. large obstacles | no | **only flags** allowed adjacent |
| Flag | a flag | (is a flag) | no flags directly adjacent |
| Building | a building | (is a building) | special BQ handling |

So: small landscape decor (mushrooms, pebbles, small bushes) = **None** -> does not block
building and is auto-removed when you build. Granite/large stones, dead trees, cacti,
stalagmites = **Single** (or FlagsAround for big ones) -> block their node. Trees = **Tree**
-> only huts fit next to a forest edge. This is the rule the engine's buildability check
must apply, not the raw sprite index.

---

## 2. Trees

### 2a. Runtime tree state (`nodeObjs/noTree.*`)
- `type` = species (0..8). `size` = growth stage 0..3 (**3 = fully grown / fellable**).
- `ProducesWood() == (type != 5)`: species **5 produces no wood** (the pineapple; woodcutter
  code comment "don't fell pineapple"). Only fully-grown wood species can be felled.
- Growth timing: per stage, wait 835 GF + grow 15 GF; 3 stages sapling->full (CONSTANTS.md,
  TICKS.md).
- `GetBM()` = `BlockingManner::Tree`.
- Forester plants species valid for the landscape (`figures/nofForester.cpp AVAILABLE_TREES`):
  - Greenland/temperate: `{0,1,2,6,7,8}`
  - Landscape type 1 (dry/secondary): `{0,1,7}`
  - Landscape type 2 (winter/snow): `{0,1,6,8}`

**Species id -> name** (inferred by cross-referencing the woodcutter "no pineapple" rule at
id 5 with the settlers2.net sprite ordering; id 5 = no-wood is confirmed, the rest are the
S2 species order):

| type | species | produces wood |
|:--:|---------|:--:|
| 0 | Pine | yes |
| 1 | Birch | yes |
| 2 | Oak | yes |
| 3 | Palm 1 | yes |
| 4 | Palm 2 | yes |
| 5 | Pineapple | **no** |
| 6 | Cypress | yes |
| 7 | Cherry | yes |
| 8 | Fir | yes |

### 2b. WLD map-file tree encoding (settlers2.net objects table)
Object **type** byte in `{0xC4, 0xC5, 0xC6, 0xC7}`; object **index** byte selects species
+ growth/cut stage. Each state is an **8-frame group** (index low 3 bits = animation frame
0-7). Growth stages appear as paired planted/cut groups:

| species | type | index range | stage |
|---------|:--:|:--:|-------|
| Pine | 0xC4 | 00-07 | planted step 1 (sapling) |
| Pine | 0xC4 | 10-17 | planted step 2 |
| Pine | 0xC4 | 20-27 | planted step 3 |
| Pine | 0xC4 | 30-37 | mature |
| (Pine cut/falling groups occupy 08-0F, 18-1F, 28-2F, 38-3F) | | | |
| Birch | 0xC4 | 70-77 | (mature; own growth groups analogous) |
| Oak | 0xC4 | B0-B7 | mature |
| Palm 1 | 0xC4 | F0-F7 | mature |
| Palm 2 | 0xC5 | 30-37 | mature |
| Pineapple | 0xC5 | 70-77 | mature (no wood) |
| Cypress | 0xC5 | B0-B7 | mature |
| Cherry | 0xC5 | F0-F7 | mature |
| Fir | 0xC6 | 30-37 | mature |

The **mature** group index of each species (used most in maps) follows the repeating
`30-37 / 70-77 / B0-B7 / F0-F7` per 0x40 step, then rolls into the next type byte. Sprites
live in the map-object bitmap archive (`MAPBOBS.LST` / `map_?_z.lst`); each group = 8 frames
for the sway/fall animation. **Caveat (settlers2.net):** placing a "cut" tree stage in a
map makes the tree unremovable in game — use planted/mature groups only.

---

## 3. Granite / stones

### 3a. Runtime
Surface granite piles are node objects the stonemason (quarry) works; each yields Stones and
its stored quantity decrements to 0 then the object is removed. Blocking = `Single`
(large piles `FlagsAround`).

### 3b. WLD map-file encoding
Object **type** byte in `{0xCC, 0xCD, 0xCE, 0xCF}` (two granite kinds). Object **index**
low nibble = remaining quantity **1..6** (`6` = maximum / full pile; `1` = nearly depleted).
There are two granite graphic types (small/large pile). Index `0` is the small "shrub"
granite form still collectible as stone.

---

## 4. Decorative / landscape objects (settlers2.net objects table)

Landscape objects (map-file object-type "landscape" bit set). Index selects the decoration.
Most are **BlockingManner::None** (removable, do not block building); larger ones
(dead trees, cactus, stalagmites, big stones) are **Single**. Representative index map:

| index | object | blocks build? |
|:--:|--------|:--:|
| 00 | Mushroom 1 | no (None) |
| 01 | Mushroom 2 | no |
| 02-04 | Stone 1-3 (small) | Single |
| 05-06 | Dead tree variants | Single |
| 07 | Bone 1 | no |
| 0A-0F | Bush / water-stone / cactus / shrub variants | mixed (bush=None, cactus/stone=Single) |
| 10-1D | Bush 2-4, Shrub 3-4, Stalagmite 1-7 | bushes/shrubs None; stalagmites Single |
| 22 | Mushroom 3 | no |
| 25-27 | Pebble 1-3 | no |
| 28-2A | Big / blue / small bush | no |

Rule of thumb for the engine: **decide blocking from the runtime `BlockingManner`, not the
index** — the loader must assign None to grass/mushroom/pebble/bush decor and Single to
stones/dead-trees/cacti/stalagmites. (Exact per-index blocking that isn't obvious should be
verified against a real converted map; treat the table above as the classification guide.)

---

## 5. Resource layer (subsurface)

### 5a. Runtime encoding (authoritative for our engine)
Source `gameTypes/Resource.h`. One byte per node: **high nibble = type, low nibble =
amount (0..15)**. Max amount is 15. Amount 0 or type 0 = nothing.

| high nibble | ResourceType |
|:--:|-----------|
| 0 | Nothing |
| 1 | Iron |
| 2 | Gold |
| 3 | Coal |
| 4 | Granite (mineable in mountains) |
| 5 | Water (for wells) |
| 6 | Fish (in water) |

Miner decrements the chosen node's amount by 1 per production cycle; when all matching nodes
within `MINER_RADIUS=2` reach 0 the mine is exhausted. Fisher likewise depletes Fish nodes;
wells over Water are effectively inexhaustible in vanilla (a well never runs dry) but the
Water resource marks where wells find water. `ReduceResource` clamps at 0.

### 5b. WLD map-file resource block (settlers2.net) — for the loader only
The map file stores resources with a different byte scheme; the loader translates to §5a:

| byte value | resource |
|:--:|-----------|
| 0x21 | Water |
| 0x40-0x47 | Coal (0x40+amount) |
| 0x48-0x4F | Iron ore |
| 0x50-0x57 | Gold |
| 0x58-0x5F | Granite |
| 0x87 | Fish |

Here the low 3 bits of the mineral bytes carry the amount (0-7 in file); RttR's runtime
allows up to 15 (§5a), so the loader maps the file's 0-7 range into the runtime nibble.
**Flagged discrepancy:** the file amount span (0-7) is narrower than the runtime span
(0-15); when writing the map loader, verify the exact per-value amount against a converted
reference map rather than assuming a 1:1 or ×2 scale.

### 5c. Buildable-site block (WLD block 9) — loader reference
settlers2.net "Buildable Sites" byte per node (drives initial BQ):
`01`=Flag, `02`=Hut, `03`=House, `04`=Castle, `05`=Mine, `09`=Flag near inaccessible
terrain, `0C`=Castle near water, `0D`=Mine near water, `68`=occupied by tree, `78`=occupied
by inaccessible terrain. The engine recomputes BQ from terrain + objects at runtime, so this
is a cross-check for the loader, not a runtime source of truth.

---

## 6. Sources
settlers2.net `/documentation/objects/` and `/documentation/world-map-file-format-wldswd/`;
RttR `gameTypes/Resource.h`, `nodeObjs/noBase.h`, `nodeObjs/noTree.{h,cpp}`,
`nodeObjs/noGrainfield.cpp`, `figures/nofForester.cpp`, `figures/nofWoodcutter.cpp`.
Independent WLD/SWD spec (cross-check): github.com/Merri/map-generator/wiki.
