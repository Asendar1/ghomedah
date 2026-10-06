# ghomedah

Browser multiplayer office hunt: everyone searches cabinets, one finds the poison and becomes the hunter — the office goes dark, and the infected turn and join the hunt. 2–8 players per room, one 90-second round.

**Play:** coming with the first deploy — open the link, share `?room=anything` with friends.

## How to play (30 seconds)

- **Move:** WASD on a close follow-cam that shows only the room around you.
- **Search:** hold **E** next to a cabinet. The bar over your head fills. One cabinet holds the poison — the finder becomes the **hunter**.
- **Survive:** searching happens in a dimly lit office — then the poison is found and the lights die: near-black, with only flashlight cones to see by. **F** toggles your beam (off hides it from everyone, but leaves you nearly blind). Use walls, break line of sight, don't get cornered.
- **Hunt:** as hunter you're just as dark — your only edge is a slightly wider lens. **Left-click** next to a survivor to infect them (1.5 s cooldown). Infected become zombies and join you.
- Preys win if at least one survives the 90 seconds; hunters win by converting everyone. Rounds reset themselves.

## Run it locally

```bash
npm install
npm run build     # builds client/ into client/dist
npm start         # one process: game + ws + /health + /stats on http://localhost:8787
```

Dev loop: `node --watch server/server.ts` + `cd client && npm run dev` (vite serves on :5173 and proxies `/ws` to the server).

## Architecture

- **npm workspaces** — `shared/` (wire protocol + geometry helpers), `server/` (Node + `ws`, no build step — Node 24 type-stripping), `client/` (Vite + React shell + Three.js).
- **Server-authoritative tick** at a nominal 30 Hz: clients only ever send *intent* (input bits, one attack event); the tick owns movement, collisions, search timers, phases and infection, and broadcasts snapshots.
- **Protocol** (`shared/protocols.ts`): JSON over ws. Snapshots ~30/s/room; the static map is sent once per connection, never in the stream.
- **Rooms** are the unit of world state — `?room=` codes, per-room cloned cabinet flags, empty rooms garbage-collected. Everything degrades to one room with zero code changes.
- **Phases**: SEARCH → HUNT (90 s) → END (10 s) → auto-reset, all room state. One poison cabinet is planted per round.
- **Interactions**: search is a held bit (a state); attack is a `{type:"attack"}` event (a tap must not fall between ticks). Both are queued by handlers and resolved only inside the tick.
- **Role vision** is pure client rendering — one ambient level for the whole room (dim during SEARCH, near-black during HUNT) plus a spotlight cone per player aimed by their movement; the hunter's only edge is a ~28% wider camera. The **F** flashlight toggle is one display-only bit relayed input → snapshot (`lit`) — no game logic reads it.

## Engineering notes

- **Tick time ≠ wall time.** `setInterval(1000/30)` on Windows actually fires every ~46 ms (15.625 ms timer quantum) → the real tick rate is ~21.4 Hz, and tick-counted durations run ~39 % slow. Every user-visible duration (search, hunt, cooldowns) accumulates wall-clock ms; movement stays per-tick.
- **Collision invariant.** Movement is attempt-and-reject against Minkowski-inflated solids + a 52 px player standoff; spawns are re-rolled until clear. A bot harness validates "no player position is ever inside a solid" under load.
- **The bots are also the demo filler** — headless ws clients with a searcher bias, spread across rooms, so an empty server still looks alive.

## Numbers (bot load test)

`node server/bots.cjs --spawn --bots N --rooms R --seconds 30` — 30 s runs on Windows (Node 24):

| bots | rooms | position checks | inside-solid violations | moved | frozen | snapshot gap p50 / p99 | throughput |
|------|-------|-----------------|-------------------------|-------|--------|------------------------|------------|
| 8    | 1     | 5,236           | 0                       | 8/8   | 0      | 47 ms / 48 ms          | ~226 msg/s |
| 32   | 4     | 21,328          | 0                       | 32/32 | 0      | 47 ms / 48 ms          | ~921 msg/s |

(32 bots in one room is politely capped at `MAX_PLAYERS = 8`.)

## Checks

No test framework — four runnable probes instead:

- `node server/probe-ws.cjs` — a fresh client must receive welcome + map + phase (deploy smoke test; pass a `ws://…` URL for any host).
- `node server/probe-infect.cjs` — the full infection rule, end to end: no click = no convert, one click converts exactly one prey, the cooldown drops early clicks and expires.
- `node server/probe-flash.cjs` — the flashlight toggle relay: off/on reaches every other client and late joiners, and a payload that omits `lit` defaults back to on.
- `node server/bots.cjs --spawn` — the invariant + cadence load check from the table above.

## Next

Post-launch: room menu / create-join UI, animation, sound (SFX/ambience only), a SEARCH-phase deadline for AFK rooms, reconnection.
