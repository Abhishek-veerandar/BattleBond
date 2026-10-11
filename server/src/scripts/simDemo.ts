// Runs one full 4-player battle in the terminal with every seat picking
// Showdown's default choice. This is the M1 "does the engine work?" check.
import { SEATS, type SeatId } from '@tagteam/shared';
import { TagTeamBattle } from '../engine/TagTeamBattle';
import { SAMPLE_TEAMS } from '../data/sampleTeams';

const names: Record<SeatId, string> = { p1: 'Ash', p2: 'Gary', p3: 'Misty', p4: 'Brock' };
const players = Object.fromEntries(SEATS.map((s) => [s, { name: names[s], team: SAMPLE_TEAMS[s] }])) as Record<
  SeatId,
  { name: string; team: string }
>;

const pending: SeatId[] = [];
let done = false;

const battle = new TagTeamBattle(players, {
  // Print p1's view of the log, minus noise.
  onLog: (seat, lines) => {
    if (seat !== 'p1') return;
    for (const l of lines) if (l && l !== '|' && !l.startsWith('|t:|')) console.log(l);
  },
  onRequest: (seat, req) => {
    if (!req.wait) pending.push(seat);
  },
  onError: (seat, msg) => console.error(`[${seat}] ${msg}`),
  onEnd: (winner, names) => {
    done = true;
    console.log(`\n=== Battle over. Winner: side ${winner ?? 'none'} (${names}) ===`);
  },
});

battle.start();

// Drain choices until the battle ends (with a safety cap).
let steps = 0;
while (!done && steps++ < 5000) {
  const seat = pending.shift();
  if (!seat) break;
  if (battle.needsChoice(seat)) battle.choose(seat, 'default');
}
if (!done) {
  console.error(`Battle did not finish (steps=${steps}, pending=${pending.length}).`);
  process.exit(1);
}
console.log(`Turns played: ${battle.battle.turn}`);
