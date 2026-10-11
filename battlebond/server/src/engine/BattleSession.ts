import {
  SEATS,
  TARGETED_MOVES,
  TURN_SECONDS,
  hitsFor,
  nameOfIdent,
  partnerOf,
  sideOf,
  type BattleRequest,
  type CalcMsg,
  type EndMsg,
  type FieldState,
  type Intent,
  type PlanMsg,
  type SeatId,
  type SeatPlan,
  type SideId,
  type TimerMsg,
} from '@tagteam/shared';
import { TagTeamBattle } from './TagTeamBattle';
import { buildCalc } from './estimates';

/**
 * One tag team battle plus the co-op layer on top of it.
 *
 * Players don't send choices straight to the simulator. They set an intent
 * (shown live to their partner), then lock it. A side's choices go to the
 * simulator only when both partners have locked, so either can still change
 * their mind until then. When the turn timer runs out, whatever is planned
 * gets locked automatically (or Showdown's default move if nothing is).
 *
 * This class has no networking in it; BattleRoom wires it to sockets, and
 * the tests drive it directly.
 */

export interface SessionPlayer {
  name: string;
  team: string;
  bot: boolean;
}

export interface SessionOutput {
  log(seat: SeatId, lines: string[]): void;
  request(seat: SeatId, request: BattleRequest): void;
  calc(seat: SeatId, calc: CalcMsg): void;
  plan(seat: SeatId, plan: PlanMsg): void;
  timer(msg: TimerMsg): void;
  field(state: FieldState): void;
  error(seat: SeatId, message: string): void;
  end(msg: EndMsg): void;
}

export interface SessionOptions {
  turnMs?: number;
  botDelayMs?: number;
  /** Run `fn` after `ms`; returns a cancel function. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
}

const CHOICE_RE = /^(?:move ([1-4])(?: (-?[12]))?( terastallize)?|switch ([1-6])|team ([1-6]{1,6})|default)$/;

export class BattleSession {
  readonly engine: TagTeamBattle;
  private readonly players: Record<SeatId, SessionPlayer>;
  private readonly out: SessionOutput;
  private readonly turnMs: number;
  private readonly botDelayMs: number;
  private readonly schedule: NonNullable<SessionOptions['schedule']>;
  private readonly now: () => number;

  private intents: Partial<Record<SeatId, Intent>> = {};
  private locked = new Set<SeatId>();
  private calcs: Partial<Record<SeatId, CalcMsg>> = {};
  private cancelTimer?: () => void;
  private deadline = 0;
  private result?: EndMsg;

  constructor(players: Record<SeatId, SessionPlayer>, out: SessionOutput, options: SessionOptions = {}) {
    this.players = players;
    this.out = out;
    this.turnMs = options.turnMs ?? TURN_SECONDS * 1000;
    this.botDelayMs = options.botDelayMs ?? 400;
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
    this.now = options.now ?? Date.now;

    this.engine = new TagTeamBattle(
      Object.fromEntries(SEATS.map((s) => [s, { name: players[s].name, team: players[s].team }])) as Record<
        SeatId,
        { name: string; team: string }
      >,
      {
        onLog: (seat, lines) => this.out.log(seat, lines),
        onRequest: (seat, request) => this.handleRequest(seat, request),
        onError: (seat, message) => this.handleError(seat, message),
        onEnd: (winner, winnerNames) => this.handleEnd({ winner, winnerNames }),
        onDecision: (decision) => this.startTimer(decision),
        onUpdate: () => this.out.field(this.engine.fieldState()),
      },
    );
  }

  start() {
    this.engine.start();
  }

  get isOver() {
    return !!this.result || this.engine.isOver;
  }

  get endResult() {
    return this.result;
  }

  /** Time left on the current decision, for players who (re)join mid-turn. */
  timerState(): TimerMsg | null {
    if (!this.cancelTimer) return null;
    return { msLeft: Math.max(0, this.deadline - this.now()), totalMs: this.turnMs, decision: this.engine.decision };
  }

  isBot(seat: SeatId) {
    return this.players[seat].bot;
  }

  /** A bot takes over a seat (player left), or a player takes it back. */
  setBot(seat: SeatId, bot: boolean, name?: string) {
    this.players[seat].bot = bot;
    if (name) this.players[seat].name = name;
    if (bot) this.scheduleBot(seat);
    this.sendPlans(sideOf(seat));
  }

  /** Re-send everything a seat needs to rebuild its screen. */
  resync(seat: SeatId) {
    const request = this.engine.requests[seat];
    if (request) this.out.request(seat, request);
    const calc = this.calcs[seat];
    if (calc) this.out.calc(seat, calc);
    this.out.field(this.engine.fieldState());
    this.out.plan(seat, this.planFor(seat));
    const timer = this.timerState();
    if (timer) this.out.timer(timer);
  }

  // ---------- player actions ----------

  /** Set a tentative choice. Visible to the partner, not yet sent to the simulator. */
  setIntent(seat: SeatId, choice: string, rqid?: number): boolean {
    if (!this.acceptsChoice(seat, rqid) || this.locked.has(seat)) return false;
    const intent = this.parseChoice(seat, choice);
    if (!intent) {
      this.out.error(seat, `Not a valid choice: ${choice}`);
      return false;
    }
    this.intents[seat] = intent;
    this.sendPlans(sideOf(seat));
    return true;
  }

  /** Lock a choice. When both partners have locked, the side's choices go to the simulator. */
  lock(seat: SeatId, choice: string, rqid?: number): boolean {
    if (!this.acceptsChoice(seat, rqid)) return false;
    const intent = this.parseChoice(seat, choice);
    if (!intent) {
      this.out.error(seat, `Not a valid choice: ${choice}`);
      return false;
    }
    this.intents[seat] = intent;
    this.locked.add(seat);
    this.sendPlans(sideOf(seat));
    this.trySubmit(sideOf(seat));
    return true;
  }

  /** Unlock, as long as the side hasn't been sent to the simulator yet. */
  unlock(seat: SeatId): boolean {
    if (!this.locked.has(seat) || !this.engine.needsChoice(seat)) return false;
    this.locked.delete(seat);
    this.sendPlans(sideOf(seat));
    return true;
  }

  // ---------- internals ----------

  private acceptsChoice(seat: SeatId, rqid?: number) {
    if (this.isOver || !this.engine.needsChoice(seat)) return false;
    const current = this.engine.requests[seat]?.rqid;
    return rqid === undefined || current === undefined || rqid === current;
  }

  /** Turn a Showdown choice string into an Intent, checking it against the seat's request. */
  parseChoice(seat: SeatId, choice: string): Intent | null {
    const request = this.engine.requests[seat];
    if (!request || typeof choice !== 'string') return null;
    const m = CHOICE_RE.exec(choice.trim());
    if (!m) return null;
    const [, moveN, locStr, tera, switchN, order] = m;
    const team = request.side.pokemon;

    if (choice.trim() === 'default') return { choice: 'default', kind: 'move', label: 'Auto' };

    if (moveN) {
      if (request.forceSwitch?.some(Boolean) || request.teamPreview) return null;
      const move = request.active?.[0]?.moves[Number(moveN) - 1];
      if (!move || move.disabled) return null;
      const targetLoc = locStr !== undefined ? Number(locStr) : undefined;
      // In doubles, single-target moves must say who they hit.
      if (TARGETED_MOVES.has(move.target) && targetLoc === undefined) return null;
      return {
        choice: choice.trim(),
        kind: 'move',
        label: move.move,
        targetLoc,
        hits: hitsFor(seat, move.target, targetLoc),
        tera: !!tera,
      };
    }
    if (switchN) {
      const mon = team[Number(switchN) - 1];
      if (!mon || mon.active || mon.condition.endsWith(' fnt')) return null;
      return { choice: choice.trim(), kind: 'switch', label: nameOfIdent(mon.ident) };
    }
    if (order) {
      if (!request.teamPreview) return null;
      const lead = team[Number(order[0]) - 1];
      if (!lead) return null;
      return { choice: choice.trim(), kind: 'team', label: nameOfIdent(lead.ident) };
    }
    return null;
  }

  private handleRequest(seat: SeatId, request: BattleRequest) {
    // A new request means a new decision for this seat: clear the old plan.
    delete this.intents[seat];
    this.locked.delete(seat);
    this.out.request(seat, request);
    if (!request.wait && !this.players[seat].bot) {
      const calc = buildCalc(this.engine, seat);
      this.calcs[seat] = calc;
      this.out.calc(seat, calc);
    } else {
      delete this.calcs[seat];
    }
    // Bots are scheduled in startTimer, once the decision number for this request is known.
    this.sendPlans(sideOf(seat));
  }

  private handleError(seat: SeatId, message: string) {
    // The simulator rejected a submitted choice: let the player pick again.
    this.locked.delete(seat);
    this.out.error(seat, message);
    this.sendPlans(sideOf(seat));
  }

  private handleEnd(msg: EndMsg) {
    if (this.result) return;
    this.result = msg;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.out.end(msg);
  }

  private scheduleBot(seat: SeatId) {
    if (!this.players[seat].bot || !this.engine.needsChoice(seat)) return;
    const decision = this.engine.decision;
    this.schedule(() => {
      if (this.engine.decision !== decision || !this.players[seat].bot) return;
      if (this.engine.needsChoice(seat) && !this.locked.has(seat)) this.lock(seat, 'default');
    }, this.botDelayMs);
  }

  /** Submit a side's choices once every seat on it that owes a choice has locked. */
  private trySubmit(side: SideId) {
    const seats = SEATS.filter((s) => sideOf(s) === side && this.engine.needsChoice(s));
    if (!seats.length || !seats.every((s) => this.locked.has(s))) return;
    const decision = this.engine.decision;
    for (const seat of seats) {
      if (this.engine.decision !== decision) break;
      if (!this.engine.needsChoice(seat)) continue;
      this.engine.choose(seat, this.intents[seat]?.choice ?? 'default');
    }
    if (this.engine.decision === decision) this.sendPlans(side);
  }

  private startTimer(decision: number) {
    this.cancelTimer?.();
    if (this.isOver) return;
    this.deadline = this.now() + this.turnMs;
    this.cancelTimer = this.schedule(() => this.expire(decision), this.turnMs);
    this.out.timer({ msLeft: this.turnMs, totalMs: this.turnMs, decision });
    for (const seat of SEATS) this.scheduleBot(seat);
  }

  /** Time's up: lock whatever each seat planned (or the default move) and submit everything. */
  private expire(decision: number) {
    if (this.isOver || this.engine.decision !== decision) return;
    this.cancelTimer = undefined;
    const seats = SEATS.filter((s) => this.engine.needsChoice(s));
    for (const seat of seats) {
      if (this.engine.decision !== decision) break;
      if (!this.engine.needsChoice(seat)) continue;
      this.locked.add(seat);
      const ok = this.engine.choose(seat, this.intents[seat]?.choice ?? 'default');
      if (!ok && this.engine.decision === decision && this.engine.needsChoice(seat)) {
        this.engine.choose(seat, 'default');
      }
    }
  }

  private planOf(seat: SeatId): SeatPlan {
    const intent = this.intents[seat] ?? null;
    const plan: SeatPlan = {
      seat,
      name: this.players[seat].name,
      intent,
      locked: this.locked.has(seat),
      idle: !this.engine.needsChoice(seat),
    };
    const moveN = intent?.kind === 'move' ? /^move (\d)/.exec(intent.choice)?.[1] : undefined;
    const table = moveN ? this.calcs[seat]?.estimates[Number(moveN) - 1] : undefined;
    if (table && intent?.hits?.length) {
      plan.estimates = {};
      for (const hit of intent.hits) if (table[hit]) plan.estimates[hit] = table[hit];
    }
    return plan;
  }

  private planFor(seat: SeatId): PlanMsg {
    return { you: this.planOf(seat), partner: this.planOf(partnerOf[seat]) };
  }

  /** Plans go only to the two partners on a side; opponents never see them. */
  private sendPlans(side: SideId) {
    for (const seat of SEATS) {
      if (sideOf(seat) === side && !this.players[seat].bot) this.out.plan(seat, this.planFor(seat));
    }
  }
}
