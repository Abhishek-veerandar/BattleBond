# BattleBond

A co-op Pokémon tag battle for the browser. Two trainers share one side of a 2v2 battle, each with 3 Pokémon, and win by coordinating every turn.

**Status:** M2 (coordination) done. M1 (battle core) done.

## Run it

Needs Node 20+ and pnpm (`npm install -g pnpm`).

```bash
pnpm install
pnpm test          # engine + co-op session tests
pnpm dev           # game server on :2567 + web client on :5173
```

Open http://localhost:5173, enter a trainer name and press **PLAY**:

- **4 tabs:** join in each tab; the battle starts when the 4th seat fills. Tabs 1 and 3 are partners, tabs 2 and 4 are rivals.
- **2 tabs + bots:** join in two tabs, then press **FILL WITH BOTS**. The two tabs are partners against a bot pair.
- **1 tab:** join, then **FILL WITH BOTS**. You play with a bot partner against a bot pair.

Refreshing a tab mid-battle puts you back in your seat (you have 30 seconds).

## How a turn works

1. Every decision starts a **45-second timer**.
2. You pick a move (and a target), a switch, or Tera. Your partner sees it live as an arrow on the field, marked *not locked*.
3. **Pings** (Focus left, Protect me, …) and **team chat** go only to your partner.
4. Damage **estimates** show on each move, and when you and your partner hit the same foe the game tells you if it's a *likely KO together*.
5. Press **LOCK IN**. You can **UNLOCK** until your partner locks too; then both choices go to the battle.
6. When the timer runs out, whatever you planned is locked for you (or a default move if you picked nothing).

Opponents never see your plans, pings or chat.

## Layout

```
shared/src/index.ts              message names + types used by client and server
server/
  src/engine/TagTeamBattle.ts    @pkmn/sim wrapper: 4-player multi format, per-seat logs/requests, public field state
  src/engine/BattleSession.ts    co-op layer: intents, locks, turn timer, bots (no networking, fully testable)
  src/engine/estimates.ts        damage estimates via @smogon/calc (foes use public info only)
  src/rooms/BattleRoom.ts        Colyseus room: seats, reconnects, pings, chat
  src/data/sampleTeams.ts        sample teams (team builder comes in M3)
  test/                          engine + session tests
client/
  src/net.ts                     connection + game state hook
  src/ui.tsx                     scaled stage, sprites, HP bars
  src/screens/Menus.tsx          title + lobby
  src/screens/Battle.tsx         battle screen
```

## Fair play

The server is authoritative: clients only send choice strings, which the server checks against the current request. Damage estimates for foes use only what every player can see (species, boosts, status, Tera type, field), never their hidden EVs or items.

Sprites load from Pokémon Showdown's sprite server. This is a private, non-commercial fan project.
