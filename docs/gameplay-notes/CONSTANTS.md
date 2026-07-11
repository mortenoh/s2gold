# Gameplay constants (facts, cited)

Clean-room fact extraction for the s2gold engine. Values are numbers/rules only (not
copyrightable); no GPL code is reproduced. Primary source is **Return-to-the-Roots
s25client** (`RttR`, github.com/Return-To-The-Roots/s25client), path
`libs/s25main/`. Cross-checked with settlers2.net where noted.

**Tick convention.** All durations below are **game frames (GF)**. RttR reference (Normal)
speed = **50 ms/GF** (`gameData/GameConsts.h SPEED_GF_LENGTHS[Normal]`), which matches our
engine's 50 ms tick exactly (`docs/engine-notes/ARCHITECTURE.md`). So 1 GF = 1 engine tick.
To get seconds at Normal speed: `GF * 0.05`. See `TICKS.md` for other speeds.

Enum orderings below are the RttR enum indices, which for S2-derived data equal the
original S2 internal ids (verified by the German comments in `gameData/GoodConsts.cpp`).

---

## 1. Ware list (GoodType)

Source: `gameTypes/GoodTypes.h` (enum `GoodType`), `gameData/GoodConsts.cpp` (names).
Internal id = enum value. Ids 25/26/34 are nation-specific shield variants; id 10 is the
returnable empty-water bucket. Id 40 (Nothing) is a sentinel, not a real ware.

| id  | GoodType       | Name          | Notes                                                       |
| --- | -------------- | ------------- | ----------------------------------------------------------- |
| 0   | Beer           | Beer          | recruit input                                               |
| 1   | Tongs          | Tongs         | tool                                                        |
| 2   | Hammer         | Hammer        | tool                                                        |
| 3   | Axe            | Axe           | tool                                                        |
| 4   | Saw            | Saw           | tool                                                        |
| 5   | PickAxe        | Pick-axe      | tool                                                        |
| 6   | Shovel         | Shovel        | tool                                                        |
| 7   | Crucible       | Crucible      | tool                                                        |
| 8   | RodAndLine     | Rod and line  | tool                                                        |
| 9   | Scythe         | Scythe        | tool                                                        |
| 10  | WaterEmpty     | (empty water) | returned bucket                                             |
| 11  | Water          | Water         | from well                                                   |
| 12  | Cleaver        | Cleaver       | tool                                                        |
| 13  | Rollingpin     | Rolling pin   | tool                                                        |
| 14  | Bow            | Bow           | tool                                                        |
| 15  | Boat           | Boat          | from shipyard                                               |
| 16  | Sword          | Sword         | recruit input                                               |
| 17  | Iron           | Iron          | smelted                                                     |
| 18  | Flour          | Flour         |                                                             |
| 19  | Fish           | Fish          | mine food                                                   |
| 20  | Bread          | Bread         | mine food                                                   |
| 21  | ShieldRomans   | Shield        | Romans shield; the "canonical" shield used in recruit logic |
| 22  | Wood           | Wood          | tree trunk / log                                            |
| 23  | Boards         | Boards        | planks                                                      |
| 24  | Stones         | Stones        |                                                             |
| 25  | ShieldVikings  | Shield        | Vikings variant                                             |
| 26  | ShieldAfricans | Shield        | Africans variant                                            |
| 27  | Grain          | Grain         |                                                             |
| 28  | Coins          | Coins         | gold coins                                                  |
| 29  | Gold           | Gold          | raw gold ore                                                |
| 30  | IronOre        | Iron ore      |                                                             |
| 31  | Coal           | Coal          |                                                             |
| 32  | Meat           | Meat          | mine food                                                   |
| 33  | Ham            | Ham           | (pig)                                                       |
| 34  | ShieldJapanese | Shield        | Japanese variant                                            |
| 35  | Grapes         | Grapes        | Gold edition                                                |
| 36  | Wine           | Wine          | Gold edition                                                |
| 37  | Skins          | Skins         | Gold edition                                                |
| 38  | Leather        | Leather       | Gold edition                                                |
| 39  | Armor          | Armor         | Gold edition                                                |

**Shield note:** each nation uses its own shield ware id (Romans 21, Vikings 25, Africans
26, Japanese 34) but they are functionally identical. Recruit logic keys on ShieldRomans
(21) as the representative slot (`buildings/nobBaseWarehouse.cpp`).

### Tools (Tool enum, correspond to metalworks output + tool-priority buttons IO:140-163)

Source: `gameTypes/GoodTypes.h` enum `Tool`, `gameData/ToolConsts.h TOOL_TO_GOOD`.
Order: Tongs, Hammer, Axe, Saw, PickAxe, Shovel, Crucible, RodAndLine, Scythe, Cleaver,
Rollingpin, Bow (12 tools). Each maps 1:1 to the GoodType of the same name.

---

## 2. Building table

Source: `gameData/BuildingConsts.cpp`/`.h`, `gameTypes/BuildingType.h`,
`gameTypes/BuildingQuality.h`, `gameTypes/BuildingTypes.h`.
Enum index = original building id. Index 30 (`Nothing9`) is unused.

**Cost** = `BUILDING_COSTS = {boards, stones}` (boards a.k.a. planks). **Size** =
`BUILDING_SIZE` build-quality class. **Worker / Produces / Consumes / spaces / oneEach**
from `BLD_WORK_DESC` (`BldWorkDescription`): `numSpacesPerWare` = how many of each input
ware the building can stock (default 6); `useOneWareEach=true` means one of _each_ listed
input is consumed per cycle, `false` means it consumes one unit of whichever listed input
it currently has most of (used by mines: any one food type).

| id  | Building        | Boards | Stones | Size    | Worker (Job)  | Produces              | Consumes (per cycle) | spaces | oneEach |
| --- | --------------- | :----: | :----: | ------- | ------------- | --------------------- | -------------------- | :----: | :-----: |
| 0   | Headquarters    |   0    |   0    | Castle  | —             | (storehouse+military) | —                    |   —    |    —    |
| 1   | Barracks        |   2    |   0    | Hut     | (soldiers)    | —                     | Coins (promotion)    |   1    |    —    |
| 2   | Guardhouse      |   2    |   3    | Hut     | (soldiers)    | —                     | Coins                |   2    |    —    |
| 3   | Skinner*        |   2    |   0    | Hut     | Skinner       | Skins                 | Ham                  |   3    |  true   |
| 4   | Watchtower      |   3    |   5    | House   | (soldiers)    | —                     | Coins                |   4    |    —    |
| 5   | Vineyard*       |   4    |   4    | Castle  | Winegrower    | Grapes                | Wood, Water          |   6    |  true   |
| 6   | Winery*         |   2    |   3    | House   | Vintner       | Wine                  | Grapes               |   6    |  true   |
| 7   | Temple*         |   4    |   7    | Castle  | TempleServant | Gold                  | Wine, Meat, Bread    |   6    |  true   |
| 8   | Tannery*        |   2    |   2    | House   | Tanner        | Leather               | Skins, Boards        |   6    |  true   |
| 9   | Fortress        |   4    |   7    | Castle  | (soldiers)    | —                     | Coins                |   6    |    —    |
| 10  | Granite mine    |   4    |   0    | Mine    | Miner         | Stones                | Fish/Meat/Bread      |   2    |  false  |
| 11  | Coal mine       |   4    |   0    | Mine    | Miner         | Coal                  | Fish/Meat/Bread      |   2    |  false  |
| 12  | Iron mine       |   4    |   0    | Mine    | Miner         | IronOre               | Fish/Meat/Bread      |   2    |  false  |
| 13  | Gold mine       |   4    |   0    | Mine    | Miner         | Gold                  | Fish/Meat/Bread      |   2    |  false  |
| 14  | Lookout tower   |   4    |   0    | Hut     | Scout         | — (vision only)       | —                    |   6    |    —    |
| 15  | Leatherworks*   |   2    |   2    | House   | LeatherWorker | Armor                 | Leather              |   6    |  true   |
| 16  | Catapult        |   4    |   2    | House   | (Helper)      | — (throws stone)      | Stones               |   4    |  true   |
| 17  | Woodcutter      |   2    |   0    | Hut     | Woodcutter    | Wood                  | —                    |   6    |    —    |
| 18  | Fishery         |   2    |   0    | Hut     | Fisher        | Fish                  | —                    |   6    |    —    |
| 19  | Quarry          |   2    |   0    | Hut     | Stonemason    | Stones                | —                    |   6    |    —    |
| 20  | Forester        |   2    |   0    | Hut     | Forester      | — (plants trees)      | —                    |   6    |    —    |
| 21  | Slaughterhouse  |   2    |   2    | House   | Butcher       | Meat                  | Ham                  |   6    |  true   |
| 22  | Hunter          |   2    |   0    | Hut     | Hunter        | Meat                  | —                    |   6    |    —    |
| 23  | Brewery         |   2    |   2    | House   | Brewer        | Beer                  | Grain, Water         |   6    |  true   |
| 24  | Armory          |   2    |   2    | House   | Armorer       | Sword/Shield**        | Iron, Coal           |   6    |  true   |
| 25  | Metalworks      |   2    |   2    | House   | Metalworker   | Tools***              | Iron, Boards         |   6    |  true   |
| 26  | Iron smelter    |   2    |   2    | House   | IronFounder   | Iron                  | IronOre, Coal        |   6    |  true   |
| 27  | Charburner*     |   4    |   3    | Castle  | CharBurner    | Coal                  | Wood, Grain          |   6    |  true   |
| 28  | Pig farm        |   3    |   3    | Castle  | PigBreeder    | Ham                   | Grain, Water         |   6    |  true   |
| 29  | Storehouse      |   4    |   3    | House   | —             | (storage)             | —                    |   —    |    —    |
| 30  | (unused)        |   0    |   0    | Nothing | —             | —                     | —                    |   —    |    —    |
| 31  | Mill            |   2    |   2    | House   | Miller        | Flour                 | Grain                |   6    |  true   |
| 32  | Bakery          |   2    |   2    | House   | Baker         | Bread                 | Flour, Water         |   6    |  true   |
| 33  | Sawmill         |   2    |   2    | House   | Carpenter     | Boards                | Wood                 |   6    |  true   |
| 34  | Mint            |   2    |   2    | House   | Minter        | Coins                 | Gold, Coal           |   6    |  true   |
| 35  | Well            |   2    |   0    | Hut     | (Helper)      | Water                 | —                    |   6    |    —    |
| 36  | Shipyard        |   2    |   3    | House   | Shipwright    | Boat (or Ship)        | Boards               |   6    |  true   |
| 37  | Farm            |   3    |   3    | Castle  | Farmer        | Grain                 | —                    |   6    |    —    |
| 38  | Donkey breeding |   3    |   3    | Castle  | DonkeyBreeder | PackDonkey (job)      | Grain, Water         |   6    |  true   |
| 39  | Harbor building |   4    |   6    | Harbor  | —             | (harbor/storage)      | —                    |   —    |    —    |

\* Gold-edition buildings (Skinner, Vineyard, Winery, Temple, Tannery, Leatherworks,
Charburner). \*\* Armory alternates producing Sword and Shield each cycle (see §5).
\*\*\* Metalworks output ware is whichever tool the player's tool-priority currently
selects; `BLD_WORK_DESC` lists Tongs only as the enum placeholder (see §7 tool production).

**Mines** consume 1 food per cycle chosen from {Fish, Meat, Bread} (whichever the mine
stocks most of); they can hold only 2 of each food (`numSpacesPerWare=2`).

### Building-quality classes (BuildingQuality enum)

Source `gameTypes/BuildingQuality.h`: `Nothing, Flag, Mine, Hut, House, Castle, Harbor`.
A node's own BQ must be `>=` the building's required class, except **Mine** which requires
exactly a mine spot (`canUseBq`). Ordering for placement: Hut < House < Castle.

### Door / flag convention

Source `figures/noFigure.cpp StartWalking`: figures **enter** a building walking
`NorthWest` into it, and **leave** walking `SouthEast` out of it. The building's own flag
sits on the node **South-East of the building node** (the door node). Mines sit "above" a
flag on a mountain node (`canUseBq` comment). Engine placement rule: a building occupies
its node; its flag node is the SE neighbour and must be free/flaggable.

### Work radius (nodes) for outdoor workers

Source `figures/nofFarmhand.cpp GetWorkRadius`, `gameData/GameConsts.h MINER_RADIUS`,
addon default (index 0) values in `addons/Addon*ReachRadius.h`.

| Worker              | Radius | Note                                               |
| ------------------- | :----: | -------------------------------------------------- |
| Miner (all mines)   |   2    | `MINER_RADIUS`; searches subsurface resource nodes |
| Woodcutter          |   6    | default; addon can raise                           |
| Forester            |   6    | default; addon can raise                           |
| Stonemason (quarry) |   8    | default; addon can raise                           |
| Fisher              |   7    | searches Fish resource nodes                       |
| Hunter              |   2    | searches for game animals                          |
| Farmer              |   2    | plants/harvests grain fields                       |
| Winegrower          |   2    | plants/harvests grape fields                       |
| Charburner          |   3    | builds charcoal piles                              |
| Carpenter (sawmill) |   0    | in-building                                        |

---

## 3. Job / settler table

Source `gameTypes/JobTypes.h` (enum), `gameData/JobConsts.cpp` (`JOB_CONSTS`, names),
`gameData/JobConsts.h` (`JobConst` struct).

`JobConst { std::optional<GoodType> tool; unsigned short work_length, wait1_length,
wait2_length; }` — all three lengths in GF. **tool** = the tool ware needed to _recruit_
this job from a Helper (`Helper + tool -> worker`); `Nothing`/empty means recruitable
with just a Helper (or, for soldiers, not recruitable this way). Production cycle uses
these lengths via the state machine `Waiting1(wait1) -> Work(work) -> Waiting2(wait2) ->
carry out` (`figures/nofWorkman.cpp`); outdoor workers (farmhand type) spend `work_length`
at the work spot.

| id  | Job                 | Tool to recruit | work | wait1 | wait2 | Notes                            |
| --- | ------------------- | --------------- | :--: | :---: | :---: | -------------------------------- |
| 0   | Helper              | (none)          | 385  |  190  |   5   | generic carrier/builder pool     |
| 1   | Woodcutter          | Axe             | 148  |  789  |   5   | outdoor; fells trees             |
| 2   | Fisher              | RodAndLine      | 129  |  825  |   5   | outdoor                          |
| 3   | Forester            | Shovel          |  66  |  304  |   5   | outdoor; plants trees            |
| 4   | Carpenter (sawmill) | Saw             | 479  |  96   |   5   |                                  |
| 5   | Stonemason (quarry) | PickAxe         | 129  |  825  |   5   | outdoor                          |
| 6   | Hunter              | Bow             |  0   |  300  |   5   | work=0 (instant at prey)         |
| 7   | Farmer              | Scythe          | 117  |  106  |   5   | outdoor                          |
| 8   | Miller              | (none)          | 470  |  95   |   5   |                                  |
| 9   | Baker               | Rollingpin      | 470  |  94   |   5   |                                  |
| 10  | Butcher             | Cleaver         | 478  |  80   |   5   |                                  |
| 11  | Miner               | PickAxe         | 583  |  558  |   5   |                                  |
| 12  | Brewer              | (none)          | 530  |  93   |   5   |                                  |
| 13  | PigBreeder          | (none)          | 390  |  160  |   5   |                                  |
| 14  | DonkeyBreeder       | (none)          | 370  |  278  |  205  |                                  |
| 15  | IronFounder         | Crucible        | 950  |  160  |   5   |                                  |
| 16  | Minter              | Crucible        | 1050 |  170  |   5   |                                  |
| 17  | Metalworker         | Tongs           | 850  |  400  |   5   |                                  |
| 18  | Armorer             | Hammer          | 940  |  170  |   5   |                                  |
| 19  | Builder             | Hammer          |  0   |   0   |   5   | construction (see §on sites)     |
| 20  | Planer              | Shovel          | 130  |   0   |   5   | flattens building site           |
| 21  | Private             | —               |  —   |   —   |   —   | soldier rank 0                   |
| 22  | PrivateFirstClass   | —               |  —   |   —   |   —   | rank 1                           |
| 23  | Sergeant            | —               |  —   |   —   |   —   | rank 2                           |
| 24  | Officer             | —               |  —   |   —   |   —   | rank 3                           |
| 25  | General             | —               |  —   |   —   |   —   | rank 4                           |
| 26  | Geologist           | Hammer          |  0   |   0   |   0   | prospects resources              |
| 27  | Shipwright          | Hammer          | 1250 |  100  |   5   | ship timing flagged TODO in RttR |
| 28  | Scout               | Bow             |  0   |   0   |   0   | explores / lookout tower         |
| 29  | PackDonkey          | (none)          |  —   |   —   |   —   | road transport animal            |
| 30  | BoatCarrier         | (none)          |  —   |   —   |   —   | water road carrier               |
| 31  | CharBurner          | Shovel          | 117  |  106  |   5   | outdoor                          |
| 32  | Winegrower          | Shovel          | 117  |  106  |   5   | outdoor                          |
| 33  | Vintner             | (none)          | 470  |  95   |   5   |                                  |
| 34  | TempleServant       | Crucible        | 470  |  95   |   5   |                                  |
| 35  | Skinner             | Cleaver         | 470  |  95   |   5   |                                  |
| 36  | Tanner              | Saw             | 470  |  95   |   5   |                                  |
| 37  | LeatherWorker       | Tongs           | 470  |  95   |   5   |                                  |

Soldier ranks: `SOLDIER_JOBS = {Private, PrivateFirstClass, Sergeant, Officer, General}`,
rank = job - Private (0..4). See `MILITARY.md`.

### Walking speed

Source `figures/noFigure.cpp StartWalking` -> `nodeObjs/noMovable.cpp StartMoving`. All
figures (carriers, workers, soldiers, donkeys) walk **1 node per 20 GF** on flat ground
(= 1.0 s at Normal). This is uniform; donkeys and boat carriers do not walk faster (see
§4). Slope changes the time (uphill slower):

| altitude delta (dest - src) |  walk GF  | ascent code |
| :-------------------------: | :-------: | :---------: |
|          0 (flat)           |    20     |      3      |
|        +1 slight up         | 30 (×1.5) |      4      |
|       +2/+3 medium up       |  40 (×2)  |      5      |
|       +4/+5 steep up        |  60 (×3)  |      6      |
|       -1 slight down        |    20     |      2      |
|      -2/-3 medium down      |    20     |      1      |
|      -4/-5 steep down       |    20     |      0      |

Downhill keeps 20 GF (only the animation differs). HEIGHT_FACTOR=5 px per altitude step
is renderer-only (`gameData/MapConsts.h`).

---

## 4. Carrier / road rules

Source `figures/nofCarrier.cpp/.h`, `nodeObjs/noFlag.cpp`.

- **Speed:** normal carrier walks 20 GF/node (§3). A carrier serves exactly one road
  segment and shuttles to its middle when idle.
- **Flag ware capacity = 8.** `noFlag` holds up to 8 wares (`WARES_POS` has 8 slots;
  `wares` static vector max_size 8).
- **Ware pickup preference at a flag:** when several wares at a flag want to go the same
  direction, the carrier/flag picks the ware with the **lowest transport-priority number**
  (highest priority) whose next hop matches (`noFlag::SelectWare`, uses
  `GamePlayer::GetTransportPriority`). Transport priority is a per-player, per-ware setting.
- **Busy-flag / two-flag rule:** an idle carrier waits at road middle. On being told of a
  ware (`AddWareJob`) it walks to that flag's side. When it has just delivered, it checks
  its **own-side flag first** for waiting wares, then the far flag
  (`nofCarrier::LookForWares`, `GoalReached`); i.e. it prefers the flag it is currently at.
- **Productivity / donkey upgrade:** carrier productivity is measured over
  `PRODUCTIVITY_GF = 6000` GF (5 min). When productivity `>= DONKEY_PRODUCTIVITY = 80` (%),
  the road auto-upgrades to a donkey road (`HandleDerivedEvent` -> `UpgradeDonkeyRoad`).
- **Donkey (PackDonkey):** a donkey road gets a second carrier (a donkey) that also moves
  1 node/20 GF but carries wares on its back; net effect is more throughput on that
  segment, not faster travel. Donkeys are bred at the donkey breeder (id 38) from Grain +
  Water (job produce cycle 370/278/205 GF).
- **Boat carrier / water roads:** water roads use a BoatCarrier (job 30) + a Boat ware
  (`CarrierType::Boat`). Later phase; same 20 GF/node base.
- **Road segment length:** roads are chains of nodes; each edge is one node step. Flag
  spacing is enforced at build time (a flag every segment); the engine's approximation
  (flag spacing >= 2 edges) is in `docs/engine-notes/ARCHITECTURE.md`. RttR itself does not
  cap segment length by a single constant here — segments are delimited by flags.

---

## 5. Production cycle numbers (P2/P3 chains)

Base worker cycle (in-building "workman"): `wait1` idle -> consume inputs -> `work` -> `wait2`
-> produce 1 output ware -> carry out (walk SoutEast to flag). Source
`figures/nofWorkman.cpp`. Outputs are **1 ware per completed cycle** unless noted.

**Woodcutter** (`figures/nofWoodcutter.cpp`): finds a fully-grown wood-producing tree
within radius 6, walks to it, `work_length=148` GF felling (tree told to `FallSoon` at
start), yields 1 Wood. Will not fell pineapple (tree type 5, `ProducesWood()==false`).

**Trees** (`nodeObjs/noTree.h`): grow through sizes 0->1->2->3 (3 = fully grown/harvestable).
Each growth step = a **wait of `WAIT_LENGTH = 835` GF** then a `GROWING_LENGTH = 15` GF
grow. So a freshly planted sapling reaches full size after ~3 x (835+15) = ~2550 GF (~128 s
at Normal). Only fully-grown, wood-producing trees can be felled.

**Forester** (`figures/nofForester.cpp`): `work_length=66` GF to plant; places a new
`noTree` at size 0 of a random species valid for the landscape. Valid species per landscape
(`AVAILABLE_TREES`): greenland `{0,1,2,6,7,8}`, dry/second `{0,1,7}`, winter `{0,1,6,8}`
(species ids: see `OBJECTS.md`). Won't plant on roads, borders, near buildings, or on
non-vital terrain.

**Sawmill / Carpenter**: consumes 1 Wood, `work_length=479` GF, produces 1 Boards.

**Quarry / Stonemason** (`figures/nofStonemason.cpp`): finds surface granite object within
radius 8, `work_length=129` GF, produces 1 Stones; decrements the granite object.

**Fishery / Fisher** (`figures/nofFisher.cpp`): finds Fish resource node within radius 7,
`work_length=129` GF, produces 1 Fish; decrements the fish resource. Depletes.

**Hunter** (`figures/nofHunter.cpp`): finds a game animal within radius 2, stalks & shoots
(work=0 at kill), returns 1 Meat.

**Farm / Farmer** (`figures/nofFarmer.cpp`): plants or harvests grain fields within radius
2; `work_length=117` GF; a harvested field yields 1 Grain.

**Grain field** (`nodeObjs/noGrainfield.cpp`): grows sizes 0->3 with wait
`GROWING_WAITING_LENGTH = 1100` GF + grow `GROWING_LENGTH = 16` GF per step (full growth
~3 x 1116 = ~3348 GF). A mature (unharvested) field withers after `3000 + rand(1000)` GF,
withering animation 20 GF. After harvest it re-withers on the same `3000 + rand(1000)`.

**Mill / Miller**: 1 Grain -> `work_length=470` GF -> 1 Flour.
**Bakery / Baker**: Flour + Water -> `work_length=470` GF -> 1 Bread.
**Well** (`Helper`): produces 1 Water, no input, in-building.
**Brewery / Brewer**: Grain + Water -> `work_length=530` GF -> 1 Beer.
**Pig farm / PigBreeder**: Grain + Water -> `work_length=390` GF -> 1 Ham.
**Slaughterhouse / Butcher**: 1 Ham -> `work_length=478` GF -> 1 Meat.

**Mines / Miner** (`figures/nofMiner.cpp`): each cycle consumes 1 food (Fish/Meat/Bread,
whichever most stocked), `work_length=583` GF, `ReduceResource` decrements the chosen
subsurface node by 1 (unless inexhaustible addon), produces 1 of {Stones (granite mine),
Coal, IronOre, Gold}. Mine works only while a matching resource node exists within
`MINER_RADIUS=2`; when none remain it reports "out of resources" and idles.

**Iron smelter / IronFounder**: IronOre + Coal -> `work_length=950` GF -> 1 Iron.
**Mint / Minter**: Gold + Coal -> `work_length=1050` GF -> 1 Coins.
**Metalworks / Metalworker**: Iron + Boards -> `work_length=850` GF -> 1 tool (type by
tool-priority, see §7).
**Armory / Armorer**: Iron + Coal -> `work_length=940` GF -> 1 weapon. The armory
**alternates** producing Sword and Shield on successive cycles (`figures/nofArmorer.cpp`;
`BLD_WORK_DESC` lists Sword as the enum default).

**Charburner** (Gold ed.): Wood + Grain -> `work_length=117` GF -> 1 Coal (charcoal,
interchangeable with mined coal).
**Vineyard / Winegrower**: Wood + Water, tends grape fields (radius 2) -> Grapes.
**Winery / Vintner**: Grapes -> `work_length=470` GF -> 1 Wine.
**Temple / TempleServant**: Wine + Meat + Bread -> `work_length=470` GF -> 1 unit of a
chosen mineral (Gold/Iron ore/Coal/Granite) — lets founders/minters keep working when
mines are exhausted.
**Skinner**: Ham -> Skins. **Tannery / Tanner**: Skins + Boards -> Leather.
**Leatherworks / LeatherWorker**: Leather -> Armor.

**Shipyard / Shipwright**: Boards -> Boat (rowing boat) or, in ship mode, a large ship;
`work_length=1250` GF (RttR flags exact ship timing as TODO).

**Catapult** (`figures/nofCatapultMan.cpp`): consumes 1 Stones per shot. See `MILITARY.md`
for range/hit logic. Between-shot wait `CATAPULT_WAIT1_LENGTH = 1300` GF
(`gameData/JobConsts.h`; the comment notes the "real" S2 value is 310 but RttR raised it to
1300 to slow ware consumption).

---

## 6. HQ starting inventory (standard game)

Source `buildings/nobHQ.cpp getStartInventory`. Selected by the "start wares" game setting
(`StartWares` enum: VLow, Low, Normal, ALot; `gameTypes/GameSettingTypes.h`). **Standard /
default free game = `Normal`.** All four presets are tabulated so the engine can offer the
setting. (Actual campaign/scenario maps may instead define per-player HQ contents in the
map file; these presets are the free-play defaults.)

### Wares

| Ware            | VLow | Low | Normal | ALot |
| --------------- | :--: | :-: | :----: | :--: |
| Beer            |  0   |  0  |   6    |  12  |
| Tongs           |  1   |  0  |   0    |  0   |
| Hammer          |  4   |  8  |   16   |  32  |
| Axe             |  1   |  3  |   6    |  12  |
| Saw             |  0   |  1  |   2    |  4   |
| PickAxe         |  0   |  1  |   2    |  4   |
| Shovel          |  1   |  2  |   4    |  8   |
| Crucible        |  1   |  2  |   4    |  8   |
| RodAndLine      |  1   |  3  |   6    |  12  |
| Scythe          |  2   |  4  |   8    |  16  |
| Cleaver         |  0   |  1  |   2    |  4   |
| Rollingpin      |  1   |  1  |   2    |  4   |
| Bow             |  0   |  1  |   2    |  4   |
| Boat            |  0   |  6  |   12   |  24  |
| Sword           |  0   |  0  |   6    |  12  |
| Fish            |  1   |  2  |   4    |  8   |
| Bread           |  2   |  4  |   8    |  16  |
| Shield (Romans) |  0   |  0  |   6    |  12  |
| Wood            |  6   | 12  |   24   |  48  |
| Boards          |  11  | 22  |   44   |  88  |
| Stones          |  17  | 34  |   68   | 136  |
| IronOre         |  4   |  8  |   16   |  32  |
| Coal            |  4   |  8  |   16   |  32  |
| Meat            |  0   |  3  |   6    |  12  |

(All wares not listed = 0 at start: Water, Iron, Flour, Grain, Coins, Gold, Ham, Grapes,
Wine, Skins, Leather, Armor, other nation shields.)

### Settlers / jobs

| Job               | VLow | Low | Normal | ALot |
| ----------------- | :--: | :-: | :----: | :--: |
| Helper            |  13  | 26  |   52   | 104  |
| Woodcutter        |  2   |  4  |   8    |  16  |
| Forester          |  1   |  2  |   4    |  8   |
| Carpenter         |  1   |  2  |   4    |  8   |
| Stonemason        |  1   |  2  |   4    |  8   |
| Hunter            |  1   |  1  |   2    |  4   |
| Miner             |  2   |  5  |   10   |  20  |
| Metalworker       |  0   |  1  |   2    |  4   |
| Armorer           |  1   |  2  |   4    |  8   |
| Builder           |  2   |  5  |   10   |  20  |
| Planer            |  1   |  3  |   6    |  12  |
| Private (soldier) |  13  | 26  |   46   |  92  |
| Geologist         |  2   |  3  |   6    |  12  |
| Scout             |  1   |  1  |   2    |  4   |
| PackDonkey        |  2   |  4  |   8    |  16  |

(Jobs not listed = 0 at start: Fisher, Farmer, Miller, Baker, Butcher, Brewer, PigBreeder,
DonkeyBreeder, IronFounder, Minter, higher soldier ranks, Shipwright.)

---

## 7. Recruitment & tool production

Source `buildings/nobBaseWarehouse.cpp` (`TryRecruiting`, `HandleRecruit`).

- **Soldier recruitment (in any warehouse/HQ):** 1 new **Private** (rank 0) costs
  **1 Sword + 1 Shield + 1 Beer + 1 Helper** (the Helper becomes the soldier). Recruit
  time `RECRUITE_GF = 200 + rand(RECRUITE_RANDOM_GF = 200)` GF.
- **Recruit ratio:** the number recruited is scaled by military setting slot 0
  (recruiting-strength slider) via `real = max * ratio / SCALE` with a random rounding of
  the remainder. Max possible = min(Sword, Shield, Beer, Helper) in the warehouse.
- **Tool recruitment of civilian jobs:** a job that needs a tool is created from
  `1 Helper + 1 <tool ware>` (see §3 tool column). Jobs with no tool are created from a
  Helper alone; soldiers are the special beer+sword+shield case above.
- **Tool production:** the **metalworks** consumes Iron + Boards per cycle (850 GF) and
  produces **one tool**; which of the 12 tools is produced is governed by the player's
  tool-priority settings (12 sliders, `Tool` enum / IO buttons 140-163). Iron for tools
  and weapons comes from the iron smelter.

---

## 8. Cross-reference: source files

All under `github.com/Return-To-The-Roots/s25client/libs/s25main/`:
`gameData/BuildingConsts.{h,cpp}`, `gameData/JobConsts.{h,cpp}`, `gameData/GoodConsts.cpp`,
`gameData/ToolConsts.h`, `gameData/GameConsts.h`, `gameData/MilitaryConsts.h` (see
MILITARY.md), `gameData/NationConsts.h`, `gameTypes/{GoodTypes,JobTypes,BuildingType,
BuildingQuality,BuildingTypes,GameSettingTypes}.h`, `buildings/nobHQ.cpp`,
`buildings/nobBaseWarehouse.cpp`, `figures/no{Figure,Movable}.cpp`,
`figures/nof{Carrier,Workman,Woodcutter,Forester,Miner,Stonemason,Fisher,Farmer,Hunter,
CatapultMan,Farmhand}.cpp`, `nodeObjs/{noTree,noGrainfield,noFlag}.*`,
`addons/Addon*ReachRadius.h`.
