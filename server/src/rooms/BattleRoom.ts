import { Room, type Client } from 'colyseus';
import {
  Msg,
  SEATS,
  type ChooseMsg,
  type EndMsg,
  type LobbyState,
  type SeatId,
  type SeatInfo,
} from '@tagteam/shared';
import { TagTeamBattle } from '../engine/TagTeamBattle';
import { SAMPLE_TEAMS } from '../data/sampleTeams';

const BOT_DELAY_MS = 400;

/**
 * One room = one 4-seat tag team battle.
 * Seats fill in order p1, p2, p3, p4 (p1 + p3 are partners).
 * Any empty seat can be filled by a bot that always picks Showdown's default move.
 */
export class BattleRoom extends Room {
  maxClients = 4;

  private seats: Record<SeatId, (SeatInfo & { sessionId?: string }) | null> = {
    p1: null,
    p2: null,
    p3: null,
    p4: null,
  };
  private engine?: TagTeamBattle;
  /** Everything each seat has been sent, so a reconnecting tab can catch up. */
  private seatLogs: Record<SeatId, string[]> = { p1: [], p2: [], p3: [], p4: [] };

  onCreate() {
    this.onMessage(Msg.FillBots, () => {
      if (this.engine) return;
      for (const seat of SEATS) {
        if (!this.seats[seat]) {
          this.seats[seat] = { seat, name: `Bot ${seat.toUpperCase()}`, bot: true, connected: true };
        }
      }
      this.startBattle();
    });

    this.onMessage(Msg.Choose, (client, msg: ChooseMsg) => {
      const seat = this.seatOf(client);
      if (!seat || !this.engine || typeof msg?.choice !== 'string') return;
      const current = this.engine.requests[seat];
      // Drop choices meant for an older request.
      if (msg.rqid !== undefined && current?.rqid !== undefined && msg.rqid !== current.rqid) return;
      this.engine.choose(seat, msg.choice.slice(0, 100));
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    const seat = SEATS.find((s) => !this.seats[s]);
    if (!seat) throw new Error('Room is full');
    const name = (options?.name || '').trim().slice(0, 20) || `Player ${seat.toUpperCase()}`;
    this.seats[seat] = { seat, name, bot: false, connected: true, sessionId: client.sessionId };
    client.send(Msg.Seat, { seat });
    this.broadcastLobby();

    if (SEATS.every((s) => this.seats[s])) this.startBattle();
  }

  onLeave(client: Client) {
    const seat = this.seatOf(client);
    if (!seat) return;
    if (!this.engine) {
      // Battle not started yet: free the seat.
      this.seats[seat] = null;
    } else {
      // Mid-battle: a bot takes over so the others can finish (M5 adds real reconnects).
      const info = this.seats[seat]!;
      this.seats[seat] = { ...info, name: `${info.name} (bot)`, bot: true, connected: false, sessionId: undefined };
      this.maybeBotChoose(seat);
    }
    this.broadcastLobby();
  }

  private seatOf(client: Client): SeatId | undefined {
    return SEATS.find((s) => this.seats[s]?.sessionId === client.sessionId);
  }

  private clientFor(seat: SeatId): Client | undefined {
    const id = this.seats[seat]?.sessionId;
    return id ? this.clients.find((c) => c.sessionId === id) : undefined;
  }

  private lobby(): LobbyState {
    const seats = {} as LobbyState['seats'];
    for (const s of SEATS) {
      const info = this.seats[s];
      seats[s] = info ? { seat: s, name: info.name, bot: info.bot, connected: info.connected } : null;
    }
    return { seats, started: !!this.engine };
  }

  private broadcastLobby() {
    this.broadcast(Msg.Lobby, this.lobby());
  }

  private startBattle() {
    if (this.engine) return;
    void this.lock();

    const players = {} as Record<SeatId, { name: string; team: string }>;
    for (const s of SEATS) players[s] = { name: this.seats[s]!.name, team: SAMPLE_TEAMS[s] };

    try {
      this.engine = new TagTeamBattle(players, {
        onLog: (seat, lines) => {
          this.seatLogs[seat].push(...lines);
          this.clientFor(seat)?.send(Msg.Log, { lines });
        },
        onRequest: (seat, request) => {
          this.clientFor(seat)?.send(Msg.Request, request);
          this.maybeBotChoose(seat);
        },
        onError: (seat, message) => {
          if (this.seats[seat]?.bot) console.warn(`[BattleRoom] bot ${seat} choice error: ${message}`);
          this.clientFor(seat)?.send(Msg.Error, { message });
        },
        onEnd: (winner, winnerNames) => {
          const msg: EndMsg = { winner, winnerNames };
          this.broadcast(Msg.End, msg);
          // Give clients a moment to show the result, then close the room.
          this.clock.setTimeout(() => this.disconnect(), 5 * 60 * 1000);
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[BattleRoom] failed to start battle:', err);
      this.broadcast(Msg.Error, { message: `Battle failed to start: ${message}` });
      return;
    }
    this.broadcastLobby();
  }

  private maybeBotChoose(seat: SeatId) {
    if (!this.seats[seat]?.bot) return;
    this.clock.setTimeout(() => {
      if (this.engine?.needsChoice(seat)) this.engine.choose(seat, 'default');
    }, BOT_DELAY_MS);
  }
}
