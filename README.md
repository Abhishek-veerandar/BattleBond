# Tag Team — M1 (battle core)

Two players per side, 3 Pokémon each, one 4-player Showdown multi battle (p1 + p3 vs p2 + p4).
M1 proves the engine and the 4-seat room work. The UI is intentionally plain.

## Run it

Needs Node 20+ and pnpm (`corepack enable` gives you pnpm).

```bash
pnpm install
pnpm test          # M1 gate: a full 4-player battle plays to a winner
pnpm sim:demo      # same battle, printed in the terminal
pnpm dev           # game server on :2567 + web client on :5173
```

Then open http://localhost:5173:

- **4 tabs:** join in each tab; the battle starts when the 4th seat fills.
- **1 tab:** join, then press **Fill empty seats with bots**.
- **Phone on the same Wi-Fi:** open `http://<your-computer-ip>:5173`.

Seats fill in order p1, p2, p3, p4, so tabs 1 and 3 are partners (side A), tabs 2 and 4 are side B.

## Layout

```
shared/   message names + types used by client and server
server/
  src/engine/TagTeamBattle.ts   @pkmn/sim wrapper: multi format, per-seat logs and requests
  src/rooms/BattleRoom.ts       Colyseus room: seats, bots, choices
  src/data/sampleTeams.ts       hardcoded M1 teams
  src/scripts/simDemo.ts        terminal battle
  test/battle.test.ts           M1 gate tests
client/
  src/App.tsx                   join, seats, move/switch/target buttons, log
  src/formatLog.ts              Showdown protocol → readable lines
```

## How a turn works

1. The simulator sends each seat a private `request` (its moves, team, HP).
2. The player picks a move (and target), a switch, or Tera; the client sends a Showdown choice string like `move 1 2`.
3. When all 4 seats have chosen, the simulator plays the turn and the server sends each seat the log lines it is allowed to see.
4. Bots answer every request with Showdown's `default` choice.

## Where to look if something breaks

- **Battle won't start / wrong number of sides:** `makeTagTeamFormat()` in `TagTeamBattle.ts`. Showdown has no built-in "multi battle with custom teams" format, so we clone Doubles Custom Game and switch it to `multi` with 4 players.
- **"Invalid choice" on a targeted move:** target slot numbers in `App.tsx` (`selfLoc` / `partnerLoc`).
- **Can't connect from the client:** the server must be running on port 2567; set `VITE_SERVER_URL` to override.
