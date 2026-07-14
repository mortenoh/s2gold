# Player Guide

A guide to playing s2gold, the browser reimplementation of The Settlers II Gold.
It is written for a new player: what every screen and button does, how the
economy fits together, and how to avoid the mistakes that quietly stall a
settlement. If you have never played a Settlers game, start at
[Getting started](#getting-started) and read straight through.

> **About the screenshots.** The images below are generated locally by
> `pnpm guide:shots` and are **not** committed — they contain original game art,
> which this repository never ships (same policy as the converted assets; see
> `docs/FEASIBILITY.md` §1). Run `pnpm guide:shots` after converting your assets
> to produce them under `docs/guide-shots/`. The guide reads fine without them:
> every image has descriptive alt text and the surrounding prose carries the
> content.

---

## Contents

- [Getting started](#getting-started)
- [The in-game screen (HUD)](#the-in-game-screen-hud)
- [The core loop: ground, flags, roads](#the-core-loop-ground-flags-roads)
- [Terrain: what can be built where](#terrain-what-can-be-built-where)
- [The economy](#the-economy)
- [Mines and geologists](#mines-and-geologists)
- [Military](#military)
- [Seafaring](#seafaring)
- [Campaigns](#campaigns)
- [Saving, loading, and shareable games](#saving-loading-and-shareable-games)
- [Options](#options)
- [Controls reference](#controls-reference)
- [Tips and common pitfalls](#tips-and-common-pitfalls)

---

## Getting started

The title screen is where every game begins.

![Title menu: The Settlers II Gold Edition, with Roman Campaign, World Campaign, Resume last game, Load game, Unlimited play, Options, Intro and Credits over a valley backdrop](guide-shots/01-title-menu.png)

The entries, top to bottom:

| Entry                | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| **Roman Campaign**   | The ten-chapter story campaign (missions I–X). See [Campaigns](#campaigns). |
| **World Campaign**   | The eighteen conquest missions, chosen from a spinning-globe world map.     |
| **Resume last game** | Jumps straight back into your newest game. Greyed out until you have one.   |
| **Load game**        | A pointer to the in-game Load menu (saves are managed from inside a game).  |
| **Unlimited play**   | Free play: pick any map and set up opponents. This is the sandbox.          |
| **Options**          | Music and sound-effect settings.                                            |
| **Intro**            | Plays the intro video (shows "Replay intro" once watched).                  |
| **Credits**          | The people who made the original game.                                      |

The **Music: on/off** button at the bottom toggles the menu music.

### The setup screen (Unlimited play)

Choosing **Unlimited play** opens the setup screen.

![Setup screen: a map list on the left, a minimap preview of Thor's Island on the right, and a Players list with Player 1 set to Human/Romans and Player 2 set to Computer/Vikings, above a Start game button](guide-shots/02-setup-nations.png)

- **Selection of maps** (left): every converted map, with its size and player
  count. Click one to preview it.
- **Preview** (right): a minimap of the chosen map (white squares mark the
  starting headquarters), plus its size, player count and terrain type.
- **Players**: one row per starting position. **Player 1** is always you
  (Human). Each opponent slot can be set to **None** or **Computer**; the first
  opponent defaults to Computer. Solo maps show no opponent rows.
- **Nation pickers** (new): every player row has a people dropdown — **Romans**,
  **Vikings**, **Nubians** or **Japanese**. Your nation and each computer
  opponent's nation change how that settlement's buildings, flags and border
  stones look. (Nations are cosmetic, exactly as in the original.)
- **Start game** launches the map.

### Server games vs. the /play fallback

How the game is launched depends on whether the small bundled game server (a
FastAPI app) is running:

- **With the server** (`make serve`, which builds the app and runs
  `uvicorn s2gold.server.app:app` on port 8000): starting a game creates a
  **server session** at a clean URL like `/game/<map>/<id>`. That URL is
  **shareable and refreshable** — the world autosaves to the server every few
  seconds, so reloading the tab (or reopening the link) restores your game.
- **Without the server** (a plain `pnpm dev`): the game falls back to a
  `/play/<map>` URL carrying the setup as query parameters (`?ai=…&nations=…`).
  This URL still reloads into the same map and opponents, but there is no
  server-side save, so the Save/Load trays report "unavailable".

Either way you get straight into the game once you click Start.

---

## The in-game screen (HUD)

Everything you do in a game runs from one compact control bar anchored at the
bottom of the screen, plus the minimap in the corner.

![Close-up of the HUD bar: the s2gold brand, the map title, a Romans nation pill, a pause button, a 1x speed dropdown, and icon buttons, ending with a ware readout showing 24 wood, 44 boards, 68 stone](guide-shots/10-hud-bar.png)

Reading the bar from the left:

| Control               | What it does                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| **s2gold**            | Returns to the title screen.                                                                         |
| **Map title**         | The current map's name.                                                                              |
| **Nation pill**       | Your chosen people (e.g. "Romans").                                                                  |
| **Pause** (hourglass) | Pauses/resumes the simulation. Shortcut: **Space**.                                                  |
| **Speed dropdown**    | Game speed: **1×, 3×, 10×, 25×, 50×**. There is no speed key — use the dropdown.                     |
| **Game**              | The Save / Load menu (quicksave **F5**, quickload **F9**) and "Exit to title".                       |
| **Stats**             | The in-game statistics panel (per-player charts).                                                    |
| **Goods**             | Your whole inventory, summed across all warehouses.                                                  |
| **Zoom**              | Toggles 1× / 2× zoom. Shortcut: **Z**; the mouse wheel zooms freely.                                 |
| **Settings**          | A pop-up panel: map picker, fog-of-war, tick/FPS readouts, and audio.                                |
| **Ware readout**      | Live counts of your three build materials: **Wood** (raw logs), **Boards** (sawn planks), **Stone**. |

The **Settings** panel (opened from the bar) holds the switches you set once and
forget: the **Map** picker (switch maps without leaving), **Fog** of war on/off,
the debug **Tick** and **FPS** readouts (both off by default), and audio —
**SFX** mute + volume and **Music** on/off + volume.

**The minimap** (bottom-right corner) shows the whole map, tinted by territory
owner. **Click anywhere on it to jump the camera there** — the fastest way to
cross a large map.

---

## The core loop: ground, flags, roads

You build by clicking the ground. A left-click on an empty spot opens a context
menu of everything you can do there.

![Context menu open on a meadow near the headquarters: Flag, Huts, Houses and Castles entries, with the Houses category expanded into an icon grid of buildings each showing its board and stone cost](guide-shots/12-build-grid.png)

The root menu offers:

- **Flag** — place a road junction (see below), when the spot allows it.
- **Huts / Houses / Castles / Mines** — size classes. Hover (or click) one to
  open its **icon grid** of buildable buildings, each captioned with its cost
  (e.g. "2 boards, 2 stone"). Only buildings that actually fit the clicked spot
  appear, so **Mines** shows up only on mountains.
- **Coastal** — the harbor and shipyard, shown only on a valid shore.

Clicking a building's icon places its construction site and drops you straight
into **road mode** from the new site's flag, so your next click connects it up.

### Flags and the road rule

This is the single most important rule in the game:

> **Every worker and every ware travels along roads.** A building with no road
> path back to a warehouse is never staffed and never supplied — its
> construction site will sit there forever.

s2gold warns you about this: an unconnected building of yours shows a bright
orange **"!"** marker. If you see one, it needs a road.

Roads run between **flags**. Every building has its own flag (the small node just
south-east of its door). To build a road:

1. Click a flag (or a stranded building) and choose **Build road**.
2. Move the cursor toward the destination. A live preview draws the path in
   **green** when the road is valid and a red marker when it is not.
3. Click the destination flag — or any free node, which auto-places a flag
   there — to lay the road.

![Road mode from the headquarters flag: a translucent green preview path runs to a green cross marker, with the hint "Road mode: click a destination flag or free node (Esc to cancel)"](guide-shots/13-road-preview.png)

Long roads are automatically split with extra flags so carriers can hand wares
along in relays. Flags must be at least two tiles apart. Press **Esc** (or
right-click) at any time to cancel road mode or close a menu.

Clicking a **flag** also lets you **Send geologist** (see
[Mines and geologists](#mines-and-geologists)) or **Demolish flag**. Clicking one
of **your own buildings** shows its name and a **Demolish** option (the
headquarters cannot be demolished).

### Busy roads upgrade themselves

When a road stays busy carrying wares — roughly 80% of the time over a five-minute
window — it automatically upgrades to a **donkey road**: a second carrier (a pack
donkey) joins to double throughput. Upgraded roads are drawn a little darker and
wider. Donkeys are bred at a **donkey breeder**.

---

## Terrain: what can be built where

The build menu only offers what the ground allows, but it helps to know the rules
so you can read the map.

- **Normal buildings** (huts, houses, castles) need **buildable meadow**. A spot
  is buildable only when **all six terrain triangles around it** are the
  meadow/grass family — meadow, steppe, savannah and the green **mountain-meadow**
  (an alpine pasture that is walkable and buildable but is _not_ mountain). One
  bad triangle (a tree stump edge, a rock, a slope into water) makes the spot
  flag-only.
- **Mines** need **mountain**, and specifically **all six triangles must be
  mountain** — mine sites sit in the interior of a mountain, never on its edge.
  Mines come in four kinds: **coal, iron, gold and granite**.
- **Flags** can go on any walkable ground you own, at least two tiles from
  another flag.
- **Harbor and shipyard** need **coast**: buildable shore land that touches
  **navigable water** (deep water a ship can sail).
- **Blocked terrain**: open water, swamp, snow, lava and reef are impassable —
  no building, no flag, no walking.

**Landscape differences.** The meadow family is buildable on every landscape. The
hazards differ:

| Landscape                 | Notable rule                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Greenland** (temperate) | Swamp and snow are hazards. A special shallow "buildable water" tile looks like water but is solid ground you can build on. |
| **Winter**                | The desert slots freeze into **ice**, which is impassable.                                                                  |
| **Wasteland**             | Those same slots stay **walkable sand**; lava is the main hazard.                                                           |

---

## The economy

Your headquarters starts stocked with tools, food and building materials, and a
pool of settlers. Everything else you grow by building production chains. Each
building needs **boards and stone to construct**, a **worker** to occupy it (drawn
automatically from your settler pool, sometimes needing a tool), and — for
workshops — **input wares** delivered by road.

### The wood chain (build this first)

Boards are the universal building material, so wood comes first.

| Building       | Cost              | Makes          | Needs                       |
| -------------- | ----------------- | -------------- | --------------------------- |
| **Woodcutter** | 2 boards          | Wood (logs)    | Standing trees within reach |
| **Forester**   | 2 boards          | (plants trees) | Space to plant              |
| **Sawmill**    | 2 boards, 2 stone | Boards         | Wood                        |

A woodcutter fells nearby trees into logs; a sawmill saws logs into boards. Add a
**forester** so the woodcutter never runs out of trees.

![A working wood economy near the headquarters: the castle-like HQ, a sawmill and a woodcutter hut linked by roads with carriers walking them, running at 50x speed](guide-shots/14-economy.png)

### Stone

| Building         | Cost     | Makes | Needs                    |
| ---------------- | -------- | ----- | ------------------------ |
| **Quarry**       | 2 boards | Stone | Granite piles nearby     |
| **Granite mine** | 4 boards | Stone | A granite deposit + food |

A quarry chips stone from surface granite piles; once they are used up it stops,
so eventually you mine granite underground instead.

### Food and drink

Food feeds miners (and drink feeds a few chains). The grain chain is the backbone:

| Building           | Cost              | Makes | Needs                  |
| ------------------ | ----------------- | ----- | ---------------------- |
| **Farm**           | 3 boards, 3 stone | Grain | Open fields (radius 2) |
| **Well**           | 2 boards          | Water | —                      |
| **Mill**           | 2 boards, 2 stone | Flour | Grain                  |
| **Bakery**         | 2 boards, 2 stone | Bread | Flour + Water          |
| **Fishery**        | 2 boards          | Fish  | Fish in nearby water   |
| **Hunter**         | 2 boards          | Meat  | —                      |
| **Pig farm**       | 3 boards, 3 stone | Ham   | Grain + Water          |
| **Slaughterhouse** | 2 boards, 2 stone | Meat  | Ham                    |
| **Brewery**        | 2 boards, 2 stone | Beer  | Grain + Water          |

The three foods that feed mines are **fish, meat and bread** — a mine eats any one
of them per work cycle. So a mining economy needs a farm → mill → bakery chain (or
fisheries/hunters) running _before_ the mines, or they starve.

### Iron, tools and weapons

| Building         | Cost              | Makes            | Needs                  |
| ---------------- | ----------------- | ---------------- | ---------------------- |
| **Iron mine**    | 4 boards          | Iron ore         | An iron deposit + food |
| **Coal mine**    | 4 boards          | Coal             | A coal deposit + food  |
| **Iron smelter** | 2 boards, 2 stone | Iron             | Iron ore + Coal        |
| **Metalworks**   | 2 boards, 2 stone | Tools            | Iron + Boards          |
| **Armory**       | 2 boards, 2 stone | Swords & shields | Iron + Coal            |

The metalworks makes the **tools** new workers need (axes, saws, pickaxes,
scythes and so on); the armory alternates swords and shields to arm soldiers.

### Gold and coins

| Building      | Cost              | Makes | Needs                 |
| ------------- | ----------------- | ----- | --------------------- |
| **Gold mine** | 4 boards          | Gold  | A gold deposit + food |
| **Mint**      | 2 boards, 2 stone | Coins | Gold + Coal           |

Coins are what promote your soldiers (see [Military](#military)), so a gold →
mint chain underpins a strong army.

### Warehouses and where your stock lives

Your **headquarters** is your first warehouse. You can build **storehouses** to
add more, and a **harbor** is a coastal warehouse too.

Crucially, **stock is stored per warehouse, not in one global pile.** Click any
warehouse building to open **its own** inventory:

![The Goods window titled Headquarters, listing the headquarters' stock grouped into Raw materials, Food & drink, Weapons and Tools, with live counts such as 44 boards, 68 stone, 16 hammers](guide-shots/15-goods-window.png)

The HUD **Goods** button, by contrast, shows the **player-wide sum** across every
warehouse. Use the per-warehouse window to see where a shortage actually is; use
the HUD Goods button for the big picture.

---

## Mines and geologists

Before you build a mine you need to know where the ore is. That is the
**geologist's** job.

1. Build a flag near the mountains you want surveyed (mines are only allowed
   deep inside mountain terrain).
2. Click the flag and choose **Send geologist**. A geologist walks out from your
   headquarters and surveys the mountain nodes within six tiles of that flag.
3. Where the geologist finds something, it plants a **sign**. A legend appears at
   the edge of the screen so you can read them.

![A mountainside dotted with geologist survey signs, with an "Ore signs" legend listing Iron, Gold, Coal, Granite and Nothing](guide-shots/17-geologist-signs.png)

The signs mean:

| Sign        | Meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| **Iron**    | Iron ore here — build an iron mine.                                    |
| **Gold**    | Gold here — build a gold mine.                                         |
| **Coal**    | Coal here — build a coal mine.                                         |
| **Granite** | Granite here — build a granite mine.                                   |
| **Nothing** | This mountain node holds no ore (or the deposit is already exhausted). |

Build the matching mine on a signed deposit, and keep it fed with fish/meat/bread.

**Mines run dry.** Each work cycle draws the deposit down. When a mine exhausts
the ore in its reach it stops producing and shows a red depletion marker; demolish
it and rebuild on a fresh deposit. Deposits are finite (a few units to a full
seam), so a mining region has a lifespan — geologists help you plan the next one.

---

## Military

Military buildings hold soldiers and **project your borders**. Occupying one
claims the surrounding territory; that is how you expand.

The four sizes trade cost for garrison size and reach:

| Building       | Cost              | Soldiers | Territory reach |
| -------------- | ----------------- | -------- | --------------- |
| **Barracks**   | 2 boards          | 2        | small           |
| **Guardhouse** | 2 boards, 3 stone | 3        | medium          |
| **Watchtower** | 3 boards, 5 stone | 6        | large           |
| **Fortress**   | 4 boards, 7 stone | 9        | largest         |

Build one near your frontier and soldiers walk out from your headquarters to
garrison it. As they arrive, your territory (and its border stones) expands.

![The military panel over a garrisoned watchtower: it reads "Watchtower — Yours", Garrison 6/6, Private x6, and Coins 0/4 — on, with a "Stop coins" button, on a snowy island](guide-shots/16-military-panel.png)

Click **your own** military building to see its garrison broken down by rank and a
**coin** control. Soldiers start as **Privates** and are promoted up the ranks —
**Private, Private First Class, Sergeant, Officer, General** — by consuming gold
**coins** delivered from your mint. Toggle coin delivery per building with
**Send coins / Stop coins** (turn it off where you do not want to spend gold).
Higher ranks hit harder and survive more hits.

**Attacking.** Click an **enemy** military building. If it is within reach, the
panel shows how many soldiers you can send and an **Attack** button. Your soldiers
march out, fight the defenders at the enemy flag, and if they win they capture the
building — flipping its territory to you.

Two more military structures:

- **Catapult** (4 boards, 2 stone): throws stones at enemy military buildings in
  range. Keep it stocked with stone.
- **Lookout tower** (4 boards): no garrison, but a very long line of sight —
  useful for scouting through fog of war.

---

## Seafaring

On maps with open water you can cross the sea and colonise other shores.

- A **shipyard** (coastal, 2 boards + 3 stone) turns boards into **ships**.
- A **harbor** (coastal, 4 boards + 6 stone) is a warehouse that also anchors
  territory and launches expeditions.

To colonise: at a harbor, **Prepare expedition**. This gathers an expedition kit —
**4 boards, 6 stones and a builder** — from your stock over the next while. Once
the kit is ready and an idle ship is homed at the harbor, click **Start
expedition**.

![The harbor panel over a coastal harbor with a docked ship: "Harbor — Yours", stock of 44 boards and 68 stones, one ship homed here, "Expedition ready" showing Boards 4/4, Stones 6/6, Builder yes, and a "Start expedition" button, with an "Expedition ready to launch" toast](guide-shots/18-harbor-expedition.png)

Starting an expedition puts you into target-select mode: **click a coastal spot on
another shore** that the ship can reach by an all-water route. The ship sails
there and founds a new harbor — a fresh foothold with its own territory, ready to
grow a colony from. The computer opponents do this too, so watch the coasts.

---

## Campaigns

### Roman Campaign

The Roman Campaign is ten linear chapters (I–X). Selecting a chapter opens its
**briefing**; playing it runs the mission on its map with an in-game
**Objectives** panel you can open at any time. Each chapter has a clear goal —
build up an economy (chapter I asks for ten buildings), hold a share of the land,
or defeat every enemy — and a **Victory** overlay records your progress when you
meet it.

Chapters unlock in order: chapter I is always open, and finishing one unlocks the
next. Completed chapters stay **replayable**, and your progress is remembered
between visits.

### World Campaign

The World Campaign is eighteen conquest missions chosen from a world map.

![The World Campaign globe: a green marble backdrop with a colour-keyed world map, the Europe continent highlighted and marked with an X, "Start game: 1" and "Return" buttons, and a numbered mission strip 1–18 below](guide-shots/03-world-globe.png)

**Click a continent** to select its mission (the current one is highlighted and
marked with an X), then **Start game** to open its briefing. The numbered
**mission strip** below the map keeps every mission reachable — including the ones
that have no continent — and every mission is a "defeat all enemies" map.
Missions unlock in the same linear way as the Roman chapters.

---

## Saving, loading, and shareable games

Open the **Game** button on the HUD bar for saving and loading.

![The Game panel: a "Save game" row with a name field and Save button, a "Load game" list of eleven numbered trays (two filled with named saves showing their tick, nine empty), and an "Exit to title" button](guide-shots/20-save-trays.png)

- **Save game**: type a name and Save. Saves go into **eleven fixed trays per
  map**, mirroring the original's Load/Save dialog. Click an empty tray to save
  into it, or a filled one to overwrite.
- **Load game**: click a tray to load it; each filled tray shows its name and the
  game tick it was saved at. **Delete** removes a save.
- **Quicksave / quickload**: **F5** saves into the first free tray; **F9** loads
  the most recent save for the current map.
- **Exit to title** returns to the main menu.

Saving needs the game server running (see
[Server games vs. the /play fallback](#server-games-vs-the-play-fallback)).
Without it, the panel shows "Saves unavailable" — but a server **session** URL is
itself a live autosave you can bookmark and reload.

---

## Options

The **Options** screen (from the title menu) carries the audio settings, saved
across sessions:

![The Options screen: a gold "Options" heading over cycle-buttons for Music on/off, Music volume, Sound effects on/off and Effects volume, with a red Back button](guide-shots/05-options.png)

- **Music** on/off and **Music volume**.
- **Sound effects** on/off and **Effects volume**.

Each button cycles its value on click. (The same audio controls also live in the
in-game **Settings** panel.)

---

## Controls reference

| Input                                  | Action                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| **Left-click ground**                  | Open the context menu (build / flag / road / demolish)   |
| **Left-click your building**           | Its panel: warehouse goods, military garrison, or harbor |
| **Left-click enemy military building** | Attack panel (if in reach)                               |
| **Left-click minimap**                 | Jump the camera there                                    |
| **Drag** (hold + move)                 | Pan the map                                              |
| **Mouse wheel**                        | Zoom in/out at the cursor                                |
| **Arrow keys**                         | Pan the map                                              |
| **Z**                                  | Toggle 1× / 2× zoom                                      |
| **Space**                              | Pause / resume                                           |
| **Esc** or **right-click**             | Cancel road mode / close a menu                          |
| **F5**                                 | Quicksave                                                |
| **F9**                                 | Quickload                                                |

Game speed (1×–50×) has **no keyboard shortcut** — set it with the speed dropdown
on the HUD bar.

---

## Tips and common pitfalls

- **Connect everything with roads.** The number-one reason a building never
  finishes is that it has no road to a warehouse. Watch for the orange **"!"**
  marker and road it up.
- **Feed your mines before you build them.** Mines eat fish, meat or bread every
  cycle. Get a farm → mill → bakery chain (or fisheries/hunters) running first, or
  your mines idle the moment they are staffed.
- **Don't forget water.** Bakeries, breweries and pig farms all need **water** —
  build a **well** early, or those chains stall with full input buffers of
  everything except water.
- **Keep the forester near the woodcutter.** A lone woodcutter clears its trees
  and stops. A forester replants so the wood keeps flowing.
- **Build a coin economy for war.** Soldiers only promote by spending **coins**
  (gold mine → mint). Without coins, your garrisons stay Privates and lose fights
  to promoted enemies. Toggle coins off at quiet buildings to spend gold where it
  matters.
- **Use the per-warehouse Goods window to find shortages.** The HUD Goods button
  sums everything; clicking the specific warehouse shows what _that_ part of your
  network is short of.
- **Slow down to plan, speed up to run.** Pause (Space) while you lay out
  buildings and roads, then run at 10×–50× to watch the economy work.
