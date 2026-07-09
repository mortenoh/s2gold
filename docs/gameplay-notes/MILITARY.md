# Military constants & rules (facts, cited)

Source: `github.com/Return-To-The-Roots/s25client/libs/s25main/gameData/MilitaryConsts.h`,
`gameTypes/JobTypes.h`, `buildings/nobMilitary.cpp`, `buildings/nobBaseMilitary.cpp`,
`nodeObjs/noFighting.cpp`, `figures/nofCatapultMan.cpp`, `figures/nofActiveSoldier.cpp`.
Durations are GF (1 GF = 50 ms at Normal; see `TICKS.md`). Distances are map nodes.

---

## 1. Soldier ranks

Source `gameTypes/JobTypes.h`, `gameData/MilitaryConsts.h HITPOINTS`.
5 ranks; rank = Job - Private (0..4). `NUM_SOLDIER_RANKS = 5`,
`MAX_MILITARY_RANK = 4` (but capped per game by the "max rank" setting).

| rank | Job | English name | Hitpoints | attack-roll bonus (see §5) |
|:--:|-----|--------------|:--:|:--:|
| 0 | Private | Private | 3 | + rank |
| 1 | PrivateFirstClass | Private first class | 4 | + rank |
| 2 | Sergeant | Sergeant | 5 | + rank |
| 3 | Officer | Officer | 6 | + rank |
| 4 | General | General | 7 | + rank |

Higher rank = more hitpoints (survives more hits) and a higher max attack roll (§5), so
strength rises with rank. Armor (Gold edition) lets a soldier absorb one extra hit; the
armor is destroyed when it takes that hit.

---

## 2. Military buildings: capacity, gold, radius

Source `gameData/MilitaryConsts.h`. Arrays are per-building, order
**[Barracks, Guardhouse, Watchtower, Fortress]** (`NUM_MILITARY_BLDS = 4`). Same for all
nations.

| Building | BuildingType id | Max troops | Max gold coins | Armor slots | Territory radius |
|----------|:--:|:--:|:--:|:--:|:--:|
| Barracks | 1 | 2 | 1 | 1 | 8 |
| Guardhouse | 2 | 3 | 2 | 2 | 9 |
| Watchtower | 4 | 6 | 4 | 4 | 10 |
| Fortress | 9 | 9 | 6 | 6 | 11 |

`NUM_TROOPS={2,3,6,9}`, `NUM_GOLDS={1,2,4,6}`, `NUM_ARMOR={1,2,4,6}`,
`MILITARY_RADIUS={8,9,10,11}`. Also: `HQ_RADIUS = 9`, `HARBOR_RADIUS = 8`.
Military world partitioning: `MILITARY_SQUARE_SIZE = 20` nodes.

---

## 3. Occupation & territory / borders

- A newly built military building starts empty; soldiers are ordered from the nearest
  warehouse and walk in. The building's territory (owned land) is the disc of its
  radius (§2) once at least one soldier occupies it. `IsNewBuilt()` stays true until first
  occupation (catapults and enemies ignore not-yet-occupied buildings).
- Territory (ownership + border stones) is recalculated on occupation, capture, and
  destruction (`RecalcTerritory`).
- **Frontier distance:** buildings track how close the enemy is
  (`MAX_MILITARY_DISTANCE_NEAR = 18`, `MAX_MILITARY_DISTANCE_MIDDLE = 26`). Frontier
  buildings pull more troops via the troop-strength military setting.
- Gold coins are delivered to occupied military buildings up to the building's max (§2);
  coin delivery can be toggled off per building. Addon `NO_COINS_DEFAULT` starts new
  buildings with coins disabled.

### Vision / sight ranges (nodes)
Source `MilitaryConsts.h`. Added on top of the border/territory reach where "relative":
- Military building extra sight: `VISUALRANGE_MILITARY = 3` (added to border reach).
- Lookout tower (absolute): `VISUALRANGE_LOOKOUTTOWER = 20`.
- Scout: `VISUALRANGE_SCOUT = 3`. Soldier: `VISUALRANGE_SOLDIER = 2`.
- Ship: `VISUALRANGE_SHIP = 2`. Exploration ship: `VISUALRANGE_EXPLORATION_SHIP = 12`.

---

## 4. Attack mechanics

Source `buildings/nobMilitary.cpp GetNumSoldiersForAttack`, `MilitaryConsts.h`.

Constants: `BASE_ATTACKING_DISTANCE = 21`, `EXTENDED_ATTACKING_DISTANCE = 1`,
`MAX_ATTACKING_RUN_DISTANCE = 40`, `MEET_FOR_FIGHT_DISTANCE = 5`,
`MAX_FAR_AWAY_CAPTURING_DISTANCE = 15`, `SEAATTACK_DISTANCE = 15`.

**How many soldiers a building can send to attack target `dest`:**
1. Base = `(numTroops - 1) * militarySetting[3] / SCALE[3]` (attack-strength slider);
   always leaves at least 1 soldier as garrison. If numTroops <= 1, sends 0.
2. If straight-line `distance(building, dest) > 21`, subtract
   `ceil((distance - 21) / 1)` = `(distance - 21)` soldiers. If that removes them all,
   sends 0. Net: a building can attack targets up to `21 + (available soldiers)` nodes away,
   with fewer soldiers the farther out.
3. The on-foot path to the target must be reachable within `MAX_ATTACKING_RUN_DISTANCE = 40`
   nodes; otherwise 0.
4. **Selection order:** strongest soldiers are chosen first (troops are kept sorted
   weak->strong; attackers taken from the strong end).

**Combat flow:**
- Attackers walk to the target building's flag. Defenders come out to meet them; opponents
  within `MEET_FOR_FIGHT_DISTANCE = 5` move toward each other and a fight starts.
- When the last defender is beaten and attackers reach the building, the building is
  **captured** (ownership flips) if attackers remain; nearby friendly attackers within
  `MAX_FAR_AWAY_CAPTURING_DISTANCE = 15` can join the capture.
- Only occupied enemy `nobMilitary` buildings (not HQ-adjacent brand-new ones) are valid
  targets; the HQ and warehouses defend with their reserve.

---

## 5. Fight resolution & luck factor

Source `nodeObjs/noFighting.cpp` (`StartAttack`, `HandleEvent`). A fight is a duel between
two soldiers at one point; rounds alternate.

1. **Setup:** the two soldiers approach (turn=2 phase). First attacker chosen at random
   (`RANDOM_RAND(2)`).
2. **Each round** both soldiers roll a value; the roll's range depends on the
   `ADJUST_MILITARY_STRENGTH` game setting:
   - **0 (max strength):** `roll = RANDOM_RAND(rank + 6)` -> integer in `[0, rank+5]`.
   - **1 (medium, DEFAULT):** `roll = RANDOM_RAND(rank + 10)` -> `[0, rank+9]`.
   - **2 (min strength):** `roll = RANDOM_RAND(10)` -> `[0, 9]`, rank-independent.
   (`RANDOM_RAND(n)` returns `0..n-1`.)
3. **Hit test:** the *attacker* lands a hit iff `attacker_roll > defender_roll` (strict).
   Otherwise the defender successfully defends (no damage; a random defense animation 0-2).
4. On a hit, the defender loses **1 hitpoint** (`TakeHit`). If hitpoints reach 0 that
   soldier dies and the other wins; loser removed from player inventory.
5. **Timing:** each attack/defense round event = **15 GF**; the death sequence = **30 GF**.
6. **Armor:** a soldier with armor absorbs one hit (armor consumed) before losing HP.

**Luck:** because both sides roll uniformly, a higher rank shifts the *distribution*
upward (bigger max roll) so it wins more often, but any single round can go either way — a
low-rank soldier can beat a general on a lucky sequence of rolls. In "min strength" mode
rank is irrelevant (pure 50/50 per round barring ties).

Ties (`attacker_roll == defender_roll`) count as a successful defense (no hit), since the
hit test is strict `>`.

---

## 6. Promotion (gold coins)

Source `buildings/nobMilitary.cpp` (upgrade event), `gameData/MilitaryConsts.h`.

- A military building that holds >= 1 gold coin and has an upgradeable soldier schedules a
  promotion after `UPGRADE_TIME + rand(UPGRADE_TIME_RANDOM)` = `100 + rand(300)` GF.
- On the event, soldiers are promoted from the weakest upward: it upgrades **one soldier
  per distinct rank tier** in a single wave (each promoted soldier must have had a lower
  rank than the previously promoted one), so one event can raise several soldiers by one
  rank each. **1 gold coin is consumed per promotion event.** No soldier exceeds the game's
  max-rank setting.
- After promoting, the building re-checks and orders more coins if needed, and reschedules.

### Recovery
Wounded soldiers heal inside buildings: `CONVALESCE_TIME + rand(CONVALESCE_TIME_RANDOM)` =
`500 + rand(500)` GF per 1 hitpoint recovered.

### Recruitment cost (from warehouses/HQ)
1 new Private = **1 Sword + 1 Shield + 1 Beer + 1 Helper**; recruit time
`200 + rand(200)` GF. Ratio governed by military setting slot 0. (See `CONSTANTS.md` §7.)

---

## 7. Catapult

Source `figures/nofCatapultMan.cpp`, `gameData/JobConsts.h`.

- **Ammo:** consumes 1 Stones per shot (from its 4-stone store).
- **Target search:** enemy occupied `nobMilitary` buildings only (not HQ, not brand-new),
  that are **visible** (not in fog) and within **distance < 14 nodes** (found via
  `LookForMilitaryBuildings(pos, 3)` military squares). One target is chosen at **random**
  among candidates.
- **Hit chance:** **70%** (`RANDOM_RAND(99) < 70`). On a miss, the stone lands on a random
  neighbouring node (harmless). On a hit, it strikes the target building.
- **Effect of a hit:** kills one soldier in the target building (an armored soldier may
  lose armor instead of dying — see help text). Repeated hits can empty and then let the
  building be taken/destroyed.
- **Timing:** aim/rotate = `15 * (|wheel_steps| + 1)` GF; recover/return =
  `15 * (|wheel_steps| + 3)` GF; between-shot wait = `CATAPULT_WAIT1_LENGTH = 1300` GF
  (RttR-inflated; original S2 value noted as 310). `wheel_steps` is the turret rotation
  (-3..+2) toward the chosen direction.
- Catapult stone projectile speed parameter = 80 (visual/arc).

---

## 8. Fight/soldier animation ids (renderer reference)

`MilitaryConsts.h`: `FIGHT_ANIMATIONS` (per nation, rank, side) has 8 attacking frames and
3 defending sets of 8 frames each; `HIT_SOLDIERS` = flash sprite per rank;
`HIT_MOMENT = {4,4,4,4,6}` = the frame at which the victim of each rank's attacker flashes.
These are ROM_BOBS.LST sprite ids and are needed only by the renderer, not the sim.
