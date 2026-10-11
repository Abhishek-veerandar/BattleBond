import { Battle, Dex, Teams } from '@pkmn/sim';
import { SEATS, sideOf, type BattleRequest, type SeatId, type SideId } from '@tagteam/shared';

/**
 * Wraps one @pkmn/sim Battle configured as a 4-player multi battle
 * (p1 + p3 vs p2 + p4), each player bringing 3 Pokémon.
 *
 * The simulator speaks Showdown's text protocol. This class turns it into
 * per-seat events: log lines each seat is allowed to see, the private
 * request for each seat, choice errors, and the end of the battle.
 */

export interface SeatPlayer {
  name: string;
  /** Team in Showdown export (text) format. */
  team: string;
}

export interface BattleHandlers {
  onLog: (seat: SeatId, lines: string[]) => void;
  onRequest: (seat: SeatId, request: BattleRequest) => void;
  onError: (seat: SeatId, message: string) => void;
  onEnd: (winner: SideId | null, winnerNames: string) => void;
}

/** Base format we borrow rules from; we only change the game type. */
const BASE_FORMAT = 'gen9doublescustomgame';

/**
 * Showdown has no built-in "multi battle with custom teams" format, so we
 * clone Doubles Custom Game and switch it to a 4-player multi battle.
 * If this ever breaks after a @pkmn/sim update, this is the place to look.
 */
export function makeTagTeamFormat() {
  const base = Dex.formats.get(BASE_FORMAT, true);
  if (!base.exists) throw new Error(`Base format ${BASE_FORMAT} not found in @pkmn/sim`);
  const format = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
    id: 'gen9tagteam',
    name: '[Gen 9] Tag Team',
    gameType: 'multi',
    playerCount: 4,
  });
  return format as typeof base;
}

export function parseTeam(text: string) {
  const sets = Teams.import(text.trim());
  if (!sets || sets.length !== 3) {
    throw new Error(`Each player must bring exactly 3 Pokémon (got ${sets?.length ?? 0})`);
  }
  return sets;
}

export class TagTeamBattle {
  readonly battle: Battle;
  private readonly handlers: BattleHandlers;
  private ended = false;
  /** Latest request per seat, so we know who still has to choose. */
  readonly requests: Partial<Record<SeatId, BattleRequest>> = {};
  /** Seats that still owe a choice for their latest request. */
  private awaiting = new Set<SeatId>();

  constructor(players: Record<SeatId, SeatPlayer>, handlers: BattleHandlers) {
    this.handlers = handlers;

    const options: Record<string, unknown> = {
      formatid: BASE_FORMAT,
      format: makeTagTeamFormat(),
      send: (type: string, data: string | string[]) => this.receive(type, Array.isArray(data) ? data.join('\n') : data),
    };

    // The Battle constructor's typing doesn't expose every option we pass.
    this.battle = new Battle(options as unknown as ConstructorParameters<typeof Battle>[0]);

    for (const seat of SEATS) {
      const { name, team } = players[seat];
      this.battle.setPlayer(seat, { name, team: Teams.pack(parseTeam(team)) });
    }
    // Newer simulator versions start automatically once all players are set.
    if (!this.battle.started) this.battle.start();
    this.flush();
  }

  /**
   * The simulator queues log lines and requests until sendUpdates() is called
   * (Showdown's own BattleStream calls it after every command), so we flush
   * after starting and after every choice.
   */
  private flush() {
    this.battle.sendUpdates();
    // Fallback in case this simulator version doesn't emit an 'end' message.
    if (this.battle.ended && !this.ended) this.handleEnd();
  }

  get isOver() {
    return this.ended || this.battle.ended;
  }

  /** Submit a Showdown choice string for one seat. Errors arrive via onError. */
  choose(seat: SeatId, choice: string): boolean {
    if (this.isOver || !this.awaiting.has(seat)) return false;
    this.awaiting.delete(seat);
    let ok = false;
    try {
      ok = this.battle.choose(seat, choice);
    } catch (err) {
      this.handlers.onError(seat, err instanceof Error ? err.message : String(err));
    }
    if (!ok && !this.battle.ended) this.awaiting.add(seat);
    // Delivers the log for the turn and the next requests (re-adding seats to `awaiting`).
    this.flush();
    return ok;
  }

  /** True if this seat currently owes the simulator a choice. */
  needsChoice(seat: SeatId): boolean {
    return this.awaiting.has(seat) && !this.isOver;
  }

  private receive(type: string, data: string) {
    switch (type) {
      case 'update':
        this.handleUpdate(data);
        break;
      case 'sideupdate':
        this.handleSideUpdate(data);
        break;
      case 'end':
        this.handleEnd();
        break;
    }
  }

  /**
   * Public log. Lines after "|split|pN" come in pairs: the exact line for pN
   * (e.g. exact HP), then the public line everyone else sees (HP as %).
   */
  private handleUpdate(data: string) {
    const lines = data.split('\n');
    const perSeat: Record<SeatId, string[]> = { p1: [], p2: [], p3: [], p4: [] };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('|split|')) {
        const owner = line.slice('|split|'.length) as SeatId;
        const secret = lines[i + 1] ?? '';
        const pub = lines[i + 2] ?? '';
        for (const seat of SEATS) perSeat[seat].push(seat === owner ? secret : pub);
        i += 2;
      } else {
        for (const seat of SEATS) perSeat[seat].push(line);
      }
    }
    for (const seat of SEATS) {
      if (perSeat[seat].length) this.handlers.onLog(seat, perSeat[seat]);
    }
  }

  /** Private messages: "p1\n|request|{json}" or "p1\n|error|[Invalid choice] ..." */
  private handleSideUpdate(data: string) {
    const nl = data.indexOf('\n');
    const seat = data.slice(0, nl) as SeatId;
    const body = data.slice(nl + 1);
    if (body.startsWith('|request|')) {
      const json = body.slice('|request|'.length);
      if (!json) return;
      const request = JSON.parse(json) as BattleRequest;
      this.requests[seat] = request;
      if (request.wait) this.awaiting.delete(seat);
      else this.awaiting.add(seat);
      this.handlers.onRequest(seat, request);
    } else if (body.startsWith('|error|')) {
      this.handlers.onError(seat, body.slice('|error|'.length));
    } else {
      this.handlers.onLog(seat, body.split('\n'));
    }
  }

  private handleEnd() {
    if (this.ended) return;
    this.ended = true;
    const winnerName = this.battle.winner || '';
    let winner: SideId | null = null;
    for (const side of this.battle.sides) {
      if (side && winnerName && side.name === winnerName) winner = sideOf(side.id as SeatId);
    }
    // In multi battles Showdown may report the winner as "Name1 & Name2".
    if (!winner && winnerName) {
      for (const side of this.battle.sides) {
        if (side && winnerName.includes(side.name)) winner = sideOf(side.id as SeatId);
      }
    }
    this.handlers.onEnd(winner, winnerName);
  }
}
