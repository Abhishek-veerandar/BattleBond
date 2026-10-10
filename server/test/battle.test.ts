import { describe, expect, it } from 'vitest';
import { SEATS, type BattleRequest, type SeatId } from '@tagteam/shared';
import { TagTeamBattle, makeTagTeamFormat } from '../src/engine/TagTeamBattle';
import { SAMPLE_TEAMS } from '../src/data/sampleTeams';

function players() {
  return Object.fromEntries(SEATS.map((s) => [s, { name: `Player ${s}`, team: SAMPLE_TEAMS[s] }])) as Record<
    SeatId,
    { name: string; team: string }
  >;
}

describe('tag team format', () => {
  it('is a 4-player multi battle', () => {
    const f = makeTagTeamFormat();
    expect(f.gameType).toBe('multi');
    expect(f.playerCount).toBe(4);
  });
});

describe('TagTeamBattle', () => {
  it('gives each player one active Pokémon and keeps teams private', () => {
    const requests: Partial<Record<SeatId, BattleRequest>> = {};
    const logs: Record<SeatId, string[]> = { p1: [], p2: [], p3: [], p4: [] };
    const battle = new TagTeamBattle(players(), {
      onLog: (s, l) => logs[s].push(...l),
      onRequest: (s, r) => (requests[s] = r),
      onError: (s, m) => {
        throw new Error(`${s}: ${m}`);
      },
      onEnd: () => {},
    });

    expect(battle.battle.sides).toHaveLength(4);
    for (const s of SEATS) {
      expect(requests[s]?.side.id).toBe(s);
      expect(requests[s]?.side.pokemon).toHaveLength(3);
    }
    // Get past team preview if the base format has it.
    for (const s of SEATS) if (battle.needsChoice(s)) battle.choose(s, 'default');
    for (const s of SEATS) {
      const req = requests[s]!;
      if (req.active) expect(req.active).toHaveLength(1);
    }
  });

  it('plays a full battle to a winner with default choices', () => {
    let winner: string | null | undefined;
    let ended = false;
    const queue: SeatId[] = [];
    const battle = new TagTeamBattle(players(), {
      onLog: () => {},
      onRequest: (s, r) => {
        if (!r.wait) queue.push(s);
      },
      onError: (s, m) => {
        throw new Error(`${s}: ${m}`);
      },
      onEnd: (w) => {
        ended = true;
        winner = w;
      },
    });

    let steps = 0;
    while (!ended && queue.length && steps++ < 5000) {
      const s = queue.shift()!;
      if (battle.needsChoice(s)) battle.choose(s, 'default');
    }
    expect(ended).toBe(true);
    expect(['A', 'B', null]).toContain(winner);
    expect(battle.battle.turn).toBeGreaterThan(1);
  });
});
