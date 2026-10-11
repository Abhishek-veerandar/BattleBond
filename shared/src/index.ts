// Types and helpers shared by the game server and the web client.

export type SeatId = 'p1' | 'p2' | 'p3' | 'p4';
export type SideId = 'A' | 'B';

/** Showdown multi battle: p1 + p3 fight together against p2 + p4. */
export const SEATS: SeatId[] = ['p1', 'p2', 'p3', 'p4'];

export const sideOf = (seat: SeatId): SideId => (seat === 'p1' || seat === 'p3' ? 'A' : 'B');

export const partnerOf: Record<SeatId, SeatId> = { p1: 'p3', p3: 'p1', p2: 'p4', p4: 'p2' };

/** The two seats facing this seat, as [foe slot 1, foe slot 2] (Showdown target locations 1 and 2). */
export const foesOf = (seat: SeatId): [SeatId, SeatId] => (sideOf(seat) === 'A' ? ['p2', 'p4'] : ['p1', 'p3']);

/**
 * Showdown target locations in a multi battle, from one seat's point of view:
 * foes are 1 (slot a) and 2 (slot b); allies are -1 (slot a) and -2 (slot b).
 * p1/p2 stand in slot a of their side, p3/p4 in slot b.
 */
export const selfLoc = (seat: SeatId) => (seat === 'p1' || seat === 'p2' ? -1 : -2);
export const partnerLoc = (seat: SeatId) => (selfLoc(seat) === -1 ? -2 : -1);

/** Which seat a target location points at, from `seat`'s point of view. */
export function seatAtLoc(seat: SeatId, loc: number): SeatId | undefined {
  if (loc === 1 || loc === 2) return foesOf(seat)[loc - 1];
  if (loc === selfLoc(seat)) return seat;
  if (loc === partnerLoc(seat)) return partnerOf[seat];
  return undefined;
}

export const TURN_SECONDS = 45;

export interface SeatInfo {
  seat: SeatId;
  name: string;
  bot: boolean;
  connected: boolean;
}

export interface LobbyState {
  seats: Record<SeatId, SeatInfo | null>;
  started: boolean;
}

/** Message names. */
export const Msg = {
  // client → server
  FillBots: 'fillBots',
  Intent: 'intent',
  Lock: 'lock',
  Unlock: 'unlock',
  Ping: 'ping',
  Chat: 'chat',
  // server → client
  Seat: 'seat',
  Lobby: 'lobby',
  Request: 'request',
  Calc: 'calc',
  Field: 'field',
  Plan: 'plan',
  Timer: 'timer',
  Log: 'log',
  TeamEvent: 'teamEvent',
  Error: 'error',
  End: 'end',
} as const;

// ---------- Coordination ----------

/** What a player is planning to do this decision, in a form the UI can draw. */
export interface Intent {
  /** Showdown choice string, e.g. "move 3", "move 1 2 terastallize", "switch 2", "team 213". */
  choice: string;
  kind: 'move' | 'switch' | 'team';
  /** Move name, or the Pokémon switched in / led with. */
  label: string;
  /** Target location for single-target moves (see selfLoc). */
  targetLoc?: number;
  /** Seats this action hits, worked out by the server (spread moves hit several). */
  hits?: SeatId[];
  tera?: boolean;
}

/** Client → server for both Intent and Lock. The server works out the label, targets and hits itself. */
export interface ChoiceMsg {
  rqid?: number;
  /** Showdown choice string, e.g. "move 3", "move 1 2 terastallize", "switch 2", "team 213". */
  choice: string;
}

export interface SeatPlan {
  seat: SeatId;
  name: string;
  intent: Intent | null;
  locked: boolean;
  /** True when this seat owes no choice right now (e.g. partner fainted mid-turn, or already submitted). */
  idle: boolean;
  /** Damage estimate of the intent's move on each seat it hits, as [min%, max%] of that Pokémon's max HP. */
  estimates?: Partial<Record<SeatId, [number, number]>>;
}

/** Sent only to the two partners on a side. Opponents never see it. */
export interface PlanMsg {
  you: SeatPlan;
  partner: SeatPlan;
}

export interface TimerMsg {
  /** Milliseconds left when the server sent it. */
  msLeft: number;
  totalMs: number;
  decision: number;
}

export type PingType = 'focusLeft' | 'focusRight' | 'switching' | 'protectMe' | 'allOut' | 'spread';

export const PING_LABELS: Record<PingType, string> = {
  focusLeft: 'Focus left',
  focusRight: 'Focus right',
  switching: "I'm switching",
  protectMe: 'Protect me',
  allOut: 'Go all-out',
  spread: 'Spread incoming',
};

export interface PingMsg {
  type: PingType;
}

export interface ChatMsg {
  text: string;
}

/** Pings and chat, sent to both partners on a side. */
export interface TeamEventMsg {
  id: number;
  from: SeatId;
  fromName: string;
  kind: 'ping' | 'chat';
  ping?: PingType;
  text?: string;
}

// ---------- Battle data ----------

export interface MoveInfo {
  id: string;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  /** Showdown target type, e.g. "normal", "allAdjacentFoes", "allAdjacent", "self". */
  target: string;
}

/** Sent with each request: move details plus damage estimates per move and target seat. */
export interface CalcMsg {
  rqid?: number;
  moves: MoveInfo[];
  /** estimates[moveIndex][seat] = [min%, max%] */
  estimates: Partial<Record<SeatId, [number, number]>>[];
}

/** Public view of one active Pokémon. HP is a percentage, as every player sees it. */
export interface FieldMon {
  seat: SeatId;
  species: string;
  /** Showdown sprite id, e.g. "urshifu-rapidstrike". */
  sprite: string;
  hpPercent: number;
  status: string;
  fainted: boolean;
  terastallized?: string;
  /** Pokémon this trainer still has able to battle, including the active one. */
  remaining: number;
}

export interface FieldState {
  turn: number;
  weather: string | null;
  weatherTurns: number | null;
  terrain: string | null;
  /** Side conditions per side, e.g. { name: "Tailwind", turns: 2 } */
  conditions: Record<SideId, { name: string; turns: number | null }[]>;
  mons: Record<SeatId, FieldMon | null>;
}

export interface EndMsg {
  winner: SideId | null;
  winnerNames: string;
}

// ---------- Showdown's request JSON (only what the client uses) ----------

export interface RequestMove {
  move: string;
  id: string;
  pp: number;
  maxpp: number;
  target: string;
  disabled?: boolean | string;
}

export interface RequestPokemon {
  ident: string; // "p1: Incineroar"
  details: string; // "Incineroar, L50, M"
  condition: string; // "180/202" or "0 fnt"
  active: boolean;
  moves: string[];
  item: string;
  ability?: string;
  teraType?: string;
}

export interface BattleRequest {
  rqid?: number;
  wait?: boolean;
  teamPreview?: boolean;
  forceSwitch?: boolean[];
  active?: {
    moves: RequestMove[];
    trapped?: boolean;
    canTerastallize?: string;
  }[];
  side: { name: string; id: SeatId; pokemon: RequestPokemon[] };
}

/** Move targets that need the player to pick a slot. */
export const TARGETED_MOVES = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);

/** Seats a move hits, from `seat`'s point of view, given its target type and chosen location. */
export function hitsFor(seat: SeatId, target: string, loc?: number): SeatId[] {
  const [f1, f2] = foesOf(seat);
  const ally = partnerOf[seat];
  switch (target) {
    case 'allAdjacentFoes':
    case 'foeSide':
    case 'randomNormal':
      return [f1, f2];
    case 'allAdjacent':
      return [f1, f2, ally];
    case 'self':
    case 'allySide':
    case 'allyTeam':
    case 'all':
    case 'allies':
      return [];
    default: {
      const s = loc !== undefined ? seatAtLoc(seat, loc) : undefined;
      return s ? [s] : [];
    }
  }
}

export const speciesOf = (details: string) => details.split(',')[0];
export const nameOfIdent = (ident: string) => ident.split(': ')[1] ?? ident;
