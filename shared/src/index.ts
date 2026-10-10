// Types and helpers shared by the game server and the web client.

export type SeatId = 'p1' | 'p2' | 'p3' | 'p4';
export type SideId = 'A' | 'B';

/** Showdown multi battle: p1 + p3 fight together against p2 + p4. */
export const SEATS: SeatId[] = ['p1', 'p2', 'p3', 'p4'];

export const sideOf = (seat: SeatId): SideId => (seat === 'p1' || seat === 'p3' ? 'A' : 'B');

export const partnerOf: Record<SeatId, SeatId> = { p1: 'p3', p3: 'p1', p2: 'p4', p4: 'p2' };

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

/** Message names. Client → server and server → client. */
export const Msg = {
  // client → server
  FillBots: 'fillBots',
  Choose: 'choose',
  // server → client
  Seat: 'seat',
  Lobby: 'lobby',
  Request: 'request',
  Log: 'log',
  Error: 'error',
  End: 'end',
} as const;

export interface ChooseMsg {
  /** A Showdown choice string, e.g. "move 1 2", "switch 3", "team 213", "default". */
  choice: string;
  /** The request id this choice answers; stale choices are dropped. */
  rqid?: number;
}

export interface EndMsg {
  /** Winning side, or null for a tie. */
  winner: SideId | null;
  winnerNames: string;
}

// --- Minimal typing of Showdown's request JSON (only what the client uses) ---

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
