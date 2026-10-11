import { Room, type Client } from 'colyseus';
import {
  Msg,
  PING_LABELS,
  SEATS,
  partnerOf,
  type ChatMsg,
  type ChoiceMsg,
  type LobbyState,
  type PingMsg,
  type PingType,
  type SeatId,
  type SeatInfo,
  type TeamEventMsg,
} from '@tagteam/shared';
import { BattleSession } from '../engine/BattleSession';
import { SAMPLE_TEAMS } from '../data/sampleTeams';

/** Seconds a player has to reconnect before a bot takes their seat for good. */
const RECONNECT_SECONDS = 30;
/** Pings + chat lines a player may send per 5 seconds. */
const TEAM_EVENT_BURST = 6;

/**
 * One room = one 4-seat tag team battle.
 * Seats fill in order p1, p2, p3, p4 (p1 + p3 are partners, p2 + p4 are partners).
 * BattleSession does the battle and the co-op rules; this class only moves messages.
 */
export class BattleRoom extends Room {
  maxClients = 4;

  private seats: Record<SeatId, (SeatInfo & { sessionId?: string }) | null> = {
    p1: null,
    p2: null,
    p3: null,
    p4: null,
  };
  private session?: BattleSession;
  private teamEventId = 0;
  private recentEvents: Record<SeatId, number[]> = { p1: [], p2: [], p3: [], p4: [] };

  onCreate() {
    this.onMessage(Msg.FillBots, () => {
      if (this.session) return;
      for (const seat of SEATS) {
        if (!this.seats[seat]) {
          this.seats[seat] = { seat, name: `Bot ${seat.toUpperCase()}`, bot: true, connected: true };
        }
      }
      this.startBattle();
    });

    this.onMessage(Msg.Intent, (client, msg: ChoiceMsg) => {
      const seat = this.seatOf(client);
      if (seat && this.session && typeof msg?.choice === 'string') this.session.setIntent(seat, msg.choice, msg.rqid);
    });

    this.onMessage(Msg.Lock, (client, msg: ChoiceMsg) => {
      const seat = this.seatOf(client);
      if (seat && this.session && typeof msg?.choice === 'string') this.session.lock(seat, msg.choice, msg.rqid);
    });

    this.onMessage(Msg.Unlock, (client) => {
      const seat = this.seatOf(client);
      if (seat && this.session) this.session.unlock(seat);
    });

    this.onMessage(Msg.Ping, (client, msg: PingMsg) => {
      const seat = this.seatOf(client);
      if (!seat || !msg || !(msg.type in PING_LABELS) || !this.allowTeamEvent(seat)) return;
      this.sendTeamEvent(seat, { kind: 'ping', ping: msg.type as PingType });
    });

    this.onMessage(Msg.Chat, (client, msg: ChatMsg) => {
      const seat = this.seatOf(client);
      const text = typeof msg?.text === 'string' ? msg.text.trim().slice(0, 140) : '';
      if (!seat || !text || !this.allowTeamEvent(seat)) return;
      this.sendTeamEvent(seat, { kind: 'chat', text });
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    const seat = SEATS.find((s) => !this.seats[s]);
    if (!seat) throw new Error('Room is full');
    const name = (options?.name || '').trim().slice(0, 16) || `Player ${seat.toUpperCase()}`;
    this.seats[seat] = { seat, name, bot: false, connected: true, sessionId: client.sessionId };
    client.send(Msg.Seat, { seat });
    this.broadcastLobby();
    if (SEATS.every((s) => this.seats[s])) this.startBattle();
  }

  async onLeave(client: Client, consented: boolean) {
    const seat = this.seatOf(client);
    if (!seat) return;
    const info = this.seats[seat]!;

    if (!this.session) {
      // Battle not started yet: free the seat.
      this.seats[seat] = null;
      this.broadcastLobby();
      return;
    }

    info.connected = false;
    this.broadcastLobby();

    if (!consented && !this.session.isOver) {
      try {
        // Same tab refreshing or a phone dropping signal: hold the seat for a bit.
        const back = await this.allowReconnection(client, RECONNECT_SECONDS);
        info.connected = true;
        info.sessionId = back.sessionId;
        back.send(Msg.Seat, { seat });
        this.broadcastLobby();
        this.session.resync(seat);
        return;
      } catch {
        // Didn't come back in time.
      }
    }

    // Gone for good: a bot finishes the match so the partner isn't stranded.
    info.bot = true;
    info.sessionId = undefined;
    info.name = `${info.name} (bot)`;
    this.session.setBot(seat, true, info.name);
    this.broadcastLobby();
  }

  private seatOf(client: Client): SeatId | undefined {
    return SEATS.find((s) => this.seats[s]?.sessionId === client.sessionId);
  }

  private clientFor(seat: SeatId): Client | undefined {
    const id = this.seats[seat]?.sessionId;
    return id ? this.clients.find((c) => c.sessionId === id) : undefined;
  }

  private send(seat: SeatId, type: string, payload: unknown) {
    this.clientFor(seat)?.send(type, payload);
  }

  private lobby(): LobbyState {
    const seats = {} as LobbyState['seats'];
    for (const s of SEATS) {
      const info = this.seats[s];
      seats[s] = info ? { seat: s, name: info.name, bot: info.bot, connected: info.connected } : null;
    }
    return { seats, started: !!this.session };
  }

  private broadcastLobby() {
    this.broadcast(Msg.Lobby, this.lobby());
  }

  private allowTeamEvent(seat: SeatId) {
    const now = Date.now();
    const recent = this.recentEvents[seat].filter((t) => now - t < 5000);
    if (recent.length >= TEAM_EVENT_BURST) return false;
    recent.push(now);
    this.recentEvents[seat] = recent;
    return true;
  }

  /** Pings and chat go to both partners on the sender's side, never to opponents. */
  private sendTeamEvent(from: SeatId, event: Pick<TeamEventMsg, 'kind' | 'ping' | 'text'>) {
    const msg: TeamEventMsg = { id: ++this.teamEventId, from, fromName: this.seats[from]?.name ?? from, ...event };
    this.send(from, Msg.TeamEvent, msg);
    this.send(partnerOf[from], Msg.TeamEvent, msg);
  }

  private startBattle() {
    if (this.session) return;
    void this.lock();

    const players = Object.fromEntries(
      SEATS.map((s) => [s, { name: this.seats[s]!.name, team: SAMPLE_TEAMS[s], bot: this.seats[s]!.bot }]),
    ) as ConstructorParameters<typeof BattleSession>[0];

    try {
      this.session = new BattleSession(
        players,
        {
          log: (seat, lines) => this.send(seat, Msg.Log, { lines }),
          request: (seat, request) => this.send(seat, Msg.Request, request),
          calc: (seat, calc) => this.send(seat, Msg.Calc, calc),
          plan: (seat, plan) => this.send(seat, Msg.Plan, plan),
          timer: (msg) => this.broadcast(Msg.Timer, msg),
          field: (state) => this.broadcast(Msg.Field, state),
          error: (seat, message) => {
            if (this.seats[seat]?.bot) console.warn(`[BattleRoom] bot ${seat} error: ${message}`);
            this.send(seat, Msg.Error, { message });
          },
          end: (msg) => {
            this.broadcast(Msg.End, msg);
            // Give everyone time to see the result, then close the room.
            this.clock.setTimeout(() => this.disconnect(), 5 * 60 * 1000);
          },
        },
        {
          schedule: (fn, ms) => {
            const t = this.clock.setTimeout(fn, ms);
            return () => t.clear();
          },
        },
      );
      this.broadcastLobby();
      this.session.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[BattleRoom] failed to start battle:', err);
      this.broadcast(Msg.Error, { message: `Battle failed to start: ${message}` });
    }
  }
}
