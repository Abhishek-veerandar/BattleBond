import { describe, expect, it } from 'vitest';
import { SEATS, type CalcMsg, type PlanMsg, type SeatId, type TimerMsg } from '@tagteam/shared';
import { BattleSession, type SessionPlayer } from '../src/engine/BattleSession';
import { SAMPLE_TEAMS } from '../src/data/sampleTeams';

/** A fake clock so tests control the turn timer and bot delays. */
function fakeClock() {
  let now = 0;
  let tasks: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      tasks.push({ at: now + ms, fn, id });
      return () => {
        tasks = tasks.filter((t) => t.id !== id);
      };
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        tasks.sort((a, b) => a.at - b.at);
        const next = tasks[0];
        if (!next || next.at > end) break;
        tasks.shift();
        now = next.at;
        next.fn();
      }
      now = end;
    },
  };
}

/** p1 + p3 are humans (side A), p2 + p4 are bots (side B). */
function setup(humans: SeatId[] = ['p1', 'p3']) {
  const clock = fakeClock();
  const plans: Partial<Record<SeatId, PlanMsg[]>> = {};
  const calcs: Partial<Record<SeatId, CalcMsg>> = {};
  const timers: TimerMsg[] = [];
  const errors: string[] = [];
  let ended = false;
  const players = Object.fromEntries(
    SEATS.map((s) => [s, { name: s.toUpperCase(), team: SAMPLE_TEAMS[s], bot: !humans.includes(s) }]),
  ) as Record<SeatId, SessionPlayer>;
  const session = new BattleSession(
    players,
    {
      log: () => {},
      request: () => {},
      calc: (seat, c) => (calcs[seat] = c),
      plan: (seat, p) => (plans[seat] ??= []).push(p),
      timer: (t) => timers.push(t),
      field: () => {},
      error: (seat, m) => errors.push(`${seat}: ${m}`),
      end: () => (ended = true),
    },
    { schedule: clock.schedule, now: clock.now, turnMs: 45_000, botDelayMs: 300 },
  );
  session.start();
  return { session, clock, plans, calcs, timers, errors, isEnded: () => ended };
}

const lastPlan = (plans: Partial<Record<SeatId, PlanMsg[]>>, seat: SeatId) => plans[seat]?.at(-1);

/** Both humans pick their first Pokémon as lead, so turn 1 starts. */
function passTeamPreview(t: ReturnType<typeof setup>) {
  t.clock.advance(1000); // bots lock
  t.session.lock('p1', 'team 123');
  t.session.lock('p3', 'team 123');
}

describe('BattleSession', () => {
  it('starts a timer for the first decision', () => {
    const t = setup();
    expect(t.timers.length).toBeGreaterThan(0);
    expect(t.timers.at(-1)!.msLeft).toBe(45_000);
  });

  it('shows a plan to the partner only, never to opponents', () => {
    const t = setup(['p1', 'p2', 'p3', 'p4']);
    t.session.setIntent('p1', 'team 213');
    expect(lastPlan(t.plans, 'p3')?.partner.intent?.label).toBe('Amoonguss');
    expect(lastPlan(t.plans, 'p1')?.you.intent?.label).toBe('Amoonguss');
    // Opponents' latest plans never mention p1.
    for (const s of ['p2', 'p4'] as SeatId[]) {
      for (const plan of t.plans[s] ?? []) {
        expect(plan.you.seat).not.toBe('p1');
        expect(plan.partner.seat).not.toBe('p1');
      }
    }
  });

  it('waits for both partners to lock before submitting', () => {
    const t = setup();
    t.clock.advance(1000);
    t.session.lock('p1', 'team 123');
    expect(t.session.engine.needsChoice('p1')).toBe(true); // held back, partner hasn't locked
    expect(lastPlan(t.plans, 'p3')?.partner.locked).toBe(true);

    expect(t.session.unlock('p1')).toBe(true);
    expect(lastPlan(t.plans, 'p3')?.partner.locked).toBe(false);

    const before = t.session.engine.decision;
    t.session.lock('p1', 'team 123');
    t.session.lock('p3', 'team 123');
    expect(t.session.engine.decision).toBeGreaterThan(before); // turn 1 began
  });

  it('rejects choices that do not fit the request', () => {
    const t = setup();
    expect(t.session.setIntent('p1', 'move 1 1')).toBe(false); // team preview, not a move
    expect(t.session.setIntent('p1', 'rm -rf /')).toBe(false);
  });

  it('gives damage estimates and shares them with the partner', () => {
    const t = setup();
    passTeamPreview(t);
    // Incineroar (p1) Flare Blitz (move 2) at foe slot 1 (p2's Urshifu).
    const calc = t.calcs.p1!;
    expect(calc.moves[1].name).toBe('Flare Blitz');
    const est = calc.estimates[1].p2;
    expect(est).toBeDefined();
    expect(est![0]).toBeGreaterThan(0);
    expect(est![1]).toBeGreaterThanOrEqual(est![0]);

    t.session.setIntent('p1', 'move 2 1');
    const seen = lastPlan(t.plans, 'p3')!.partner;
    expect(seen.intent?.hits).toEqual(['p2']);
    expect(seen.estimates?.p2).toEqual(est);
  });

  it('auto-locks when the timer runs out', () => {
    const t = setup();
    passTeamPreview(t);
    const before = t.session.engine.decision;
    expect(t.session.setIntent('p1', 'move 4')).toBe(false); // Parting Shot needs a target
    t.session.setIntent('p1', 'move 4 2');
    t.clock.advance(45_000);
    expect(t.session.engine.decision).toBeGreaterThan(before);
  });

  it('plays a whole battle on timer alone', () => {
    const t = setup();
    for (let i = 0; i < 300 && !t.isEnded(); i++) t.clock.advance(45_000);
    expect(t.isEnded()).toBe(true);
    expect(t.errors).toEqual([]);
  });
});
