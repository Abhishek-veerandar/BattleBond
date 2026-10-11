import { useCallback, useEffect, useReducer, useRef } from 'react';
import { Client, type Room } from 'colyseus.js';
import {
  Msg,
  type BattleRequest,
  type CalcMsg,
  type EndMsg,
  type FieldState,
  type LobbyState,
  type PingType,
  type PlanMsg,
  type SeatId,
  type TeamEventMsg,
  type TimerMsg,
} from '@tagteam/shared';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
const RECONNECT_KEY = 'battlebond.reconnect';

export interface TeamEvent extends TeamEventMsg {
  at: number;
}

export interface GameState {
  phase: 'title' | 'connecting' | 'lobby' | 'battle';
  seat?: SeatId;
  lobby?: LobbyState;
  request?: BattleRequest;
  calc?: CalcMsg;
  field?: FieldState;
  plan?: PlanMsg;
  /** Local clock deadline (performance.now() ms) for the current decision. */
  timer?: { deadline: number; totalMs: number };
  log: string[];
  team: TeamEvent[];
  error?: string;
  end?: EndMsg;
}

type Action =
  | { type: 'patch'; patch: Partial<GameState> }
  | { type: 'log'; lines: string[] }
  | { type: 'team'; event: TeamEventMsg }
  | { type: 'reset' };

const initial: GameState = { phase: 'title', log: [], team: [] };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'log':
      return { ...state, log: [...state.log, ...action.lines].slice(-400) };
    case 'team':
      return { ...state, team: [...state.team, { ...action.event, at: performance.now() }].slice(-30) };
    case 'reset':
      return initial;
  }
}

function saveToken(token?: string) {
  try {
    if (token) sessionStorage.setItem(RECONNECT_KEY, token);
    else sessionStorage.removeItem(RECONNECT_KEY);
  } catch {
    // Storage blocked (private mode etc.): reconnect-on-refresh just won't work.
  }
}

function loadToken(): string | null {
  try {
    return sessionStorage.getItem(RECONNECT_KEY);
  } catch {
    return null;
  }
}

/** Everything the screens need: game state plus the actions a player can take. */
export function useGame() {
  const [state, dispatch] = useReducer(reducer, initial);
  const roomRef = useRef<Room>();
  const patch = (p: Partial<GameState>) => dispatch({ type: 'patch', patch: p });

  const wire = useCallback((room: Room) => {
    roomRef.current = room;
    saveToken(room.reconnectionToken);
    room.onMessage(Msg.Seat, (m: { seat: SeatId }) => patch({ seat: m.seat }));
    room.onMessage(Msg.Lobby, (m: LobbyState) =>
      dispatch({ type: 'patch', patch: { lobby: m, phase: m.started ? 'battle' : 'lobby' } }),
    );
    room.onMessage(Msg.Request, (m: BattleRequest) => patch({ request: m, error: undefined }));
    room.onMessage(Msg.Calc, (m: CalcMsg) => patch({ calc: m }));
    room.onMessage(Msg.Field, (m: FieldState) => patch({ field: m }));
    room.onMessage(Msg.Plan, (m: PlanMsg) => patch({ plan: m }));
    room.onMessage(Msg.Timer, (m: TimerMsg) =>
      patch({ timer: { deadline: performance.now() + m.msLeft, totalMs: m.totalMs } }),
    );
    room.onMessage(Msg.Log, (m: { lines: string[] }) => dispatch({ type: 'log', lines: m.lines }));
    room.onMessage(Msg.TeamEvent, (m: TeamEventMsg) => dispatch({ type: 'team', event: m }));
    room.onMessage(Msg.Error, (m: { message: string }) => patch({ error: m.message }));
    room.onMessage(Msg.End, (m: EndMsg) => {
      patch({ end: m });
      saveToken(undefined);
    });
    room.onLeave((code) => {
      roomRef.current = undefined;
      // 1000 = we left on purpose; anything else is a dropped connection.
      if (code !== 1000) patch({ error: 'Lost connection to the server. Refresh to rejoin.' });
    });
  }, []);

  // After a refresh, try to slip back into the same seat.
  useEffect(() => {
    const token = loadToken();
    if (!token) return;
    let cancelled = false;
    patch({ phase: 'connecting' });
    new Client(SERVER_URL)
      .reconnect(token)
      .then((room) => {
        if (cancelled) return void room.leave();
        wire(room);
      })
      .catch(() => {
        saveToken(undefined);
        if (!cancelled) patch({ phase: 'title' });
      });
    return () => {
      cancelled = true;
    };
  }, [wire]);

  const join = useCallback(
    async (name: string) => {
      patch({ phase: 'connecting', error: undefined });
      try {
        const room = await new Client(SERVER_URL).joinOrCreate('battle', { name });
        wire(room);
        patch({ phase: 'lobby' });
      } catch (err) {
        patch({
          phase: 'title',
          error: `Couldn't reach the game server at ${SERVER_URL}. Is it running? (${err instanceof Error ? err.message : String(err)})`,
        });
      }
    },
    [wire],
  );

  const send = (type: string, payload?: unknown) => roomRef.current?.send(type, payload);

  return {
    state,
    join,
    fillBots: () => send(Msg.FillBots),
    intent: (choice: string) => send(Msg.Intent, { choice, rqid: state.request?.rqid }),
    lock: (choice: string) => send(Msg.Lock, { choice, rqid: state.request?.rqid }),
    unlock: () => send(Msg.Unlock),
    ping: (type: PingType) => send(Msg.Ping, { type }),
    chat: (text: string) => send(Msg.Chat, { text }),
    leave: () => {
      saveToken(undefined);
      void roomRef.current?.leave();
      roomRef.current = undefined;
      dispatch({ type: 'reset' });
    },
  };
}

export type Game = ReturnType<typeof useGame>;
