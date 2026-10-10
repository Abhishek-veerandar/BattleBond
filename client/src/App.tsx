import { useEffect, useRef, useState } from 'react';
import { Client, type Room } from 'colyseus.js';
import {
  Msg,
  SEATS,
  TARGETED_MOVES,
  partnerOf,
  sideOf,
  type BattleRequest,
  type EndMsg,
  type LobbyState,
  type RequestMove,
  type SeatId,
} from '@tagteam/shared';
import { formatLog } from './formatLog';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;

export function App() {
  const [name, setName] = useState('');
  const [room, setRoom] = useState<Room>();
  const [joining, setJoining] = useState(false);
  const [seat, setSeat] = useState<SeatId>();
  const [lobby, setLobby] = useState<LobbyState>();
  const [request, setRequest] = useState<BattleRequest>();
  const [sent, setSent] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [end, setEnd] = useState<EndMsg>();

  async function join() {
    setJoining(true);
    setError(undefined);
    try {
      const client = new Client(SERVER_URL);
      const r = await client.joinOrCreate('battle', { name });
      r.onMessage(Msg.Seat, (m: { seat: SeatId }) => setSeat(m.seat));
      r.onMessage(Msg.Lobby, (m: LobbyState) => setLobby(m));
      r.onMessage(Msg.Request, (m: BattleRequest) => {
        setRequest(m);
        setSent(false);
        setError(undefined);
      });
      r.onMessage(Msg.Log, (m: { lines: string[] }) => setLog((prev) => [...prev, ...m.lines]));
      r.onMessage(Msg.Error, (m: { message: string }) => {
        setError(m.message);
        setSent(false);
      });
      r.onMessage(Msg.End, (m: EndMsg) => setEnd(m));
      r.onLeave(() => setError('Disconnected from the server.'));
      setRoom(r);
    } catch (err) {
      setError(`Could not connect to ${SERVER_URL}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setJoining(false);
    }
  }

  function choose(choice: string) {
    room?.send(Msg.Choose, { choice, rqid: request?.rqid });
    setSent(true);
    setError(undefined);
  }

  if (!room) {
    return (
      <div className="app">
        <h1>Tag Team · M1 test</h1>
        <div className="card row">
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
          <button className="primary" disabled={joining} onClick={join}>
            {joining ? 'Joining…' : 'Join battle'}
          </button>
        </div>
        <p className="muted">
          Open this page in 4 tabs to fill all seats, or join once and press “Fill empty seats with bots”.
        </p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <h1>Tag Team · M1 test</h1>
      <Seats lobby={lobby} me={seat} onFillBots={() => room.send(Msg.FillBots)} />
      {end ? (
        <div className="card">
          <strong>
            {end.winner === null ? 'Tie!' : end.winner === (seat && sideOf(seat)) ? 'Your side won!' : 'Your side lost.'}
          </strong>{' '}
          <span className="muted">Winner: {end.winnerNames || 'none'}</span>
        </div>
      ) : (
        lobby?.started &&
        seat &&
        request && <Actions request={request} seat={seat} sent={sent} onChoose={choose} />
      )}
      {error && <p className="error">{error}</p>}
      <Log lines={log} lobby={lobby} />
    </div>
  );
}

function Seats({ lobby, me, onFillBots }: { lobby?: LobbyState; me?: SeatId; onFillBots: () => void }) {
  if (!lobby) return <div className="card muted">Connecting…</div>;
  const label = (s: SeatId) => {
    const info = lobby.seats[s];
    if (!info) return <span className="muted">empty</span>;
    return (
      <>
        {info.name}
        {info.bot && ' 🤖'}
      </>
    );
  };
  return (
    <div className="card">
      <div className="seats">
        {(['p1', 'p2', 'p3', 'p4'] as SeatId[]).map((s) => (
          <div key={s} className={`seat ${s === me ? 'me' : ''}`}>
            <div className="muted">
              Side {sideOf(s)} · {s}
              {s === me ? ' · you' : me && s === partnerOf[me] ? ' · partner' : ''}
            </div>
            {label(s)}
          </div>
        ))}
      </div>
      {!lobby.started && (
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={onFillBots}>Fill empty seats with bots</button>
          <span className="muted">The battle starts when all 4 seats are filled.</span>
        </div>
      )}
    </div>
  );
}

function hpText(condition: string) {
  if (condition.endsWith(' fnt')) return 'fainted';
  return condition.split(' ')[0];
}

function Actions({
  request,
  seat,
  sent,
  onChoose,
}: {
  request: BattleRequest;
  seat: SeatId;
  sent: boolean;
  onChoose: (choice: string) => void;
}) {
  const [pendingMove, setPendingMove] = useState<number>();
  const [tera, setTera] = useState(false);

  useEffect(() => {
    setPendingMove(undefined);
    setTera(false);
  }, [request]);

  const team = request.side.pokemon;
  const monName = (i: number) => team[i].ident.split(': ')[1];

  const teamList = (
    <div className="row">
      {team.map((p, i) => (
        <span key={p.ident} className={`mon ${p.condition.endsWith(' fnt') ? 'fainted' : ''}`}>
          {i === 0 && p.active ? '▶ ' : ''}
          {monName(i)} ({hpText(p.condition)})
        </span>
      ))}
    </div>
  );

  if (request.wait || sent) {
    return (
      <div className="card">
        {teamList}
        <p className="muted">{sent ? 'Choice locked in. Waiting for the other players…' : 'Waiting for the other players…'}</p>
      </div>
    );
  }

  // Team preview: pick your lead; the other two keep their order.
  if (request.teamPreview) {
    return (
      <div className="card">
        <p>Pick your lead:</p>
        <div className="row">
          {team.map((_, i) => {
            const order = [i + 1, ...[1, 2, 3].filter((n) => n !== i + 1)].join('');
            return (
              <button key={i} onClick={() => onChoose(`team ${order}`)}>
                {monName(i)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const switchButtons = team.map((p, i) =>
    p.active || p.condition.endsWith(' fnt') ? null : (
      <button key={i} onClick={() => onChoose(`switch ${i + 1}`)}>
        Switch to {monName(i)} ({hpText(p.condition)})
      </button>
    ),
  );

  // Our Pokémon fainted: must switch.
  if (request.forceSwitch?.some(Boolean)) {
    return (
      <div className="card">
        {teamList}
        <p>Your Pokémon fainted. Choose a replacement:</p>
        <div className="row">{switchButtons}</div>
      </div>
    );
  }

  const active = request.active?.[0];
  if (!active) return null;

  // Multi battle target slots: foes are 1 and 2; allies are -1 and -2.
  // p1/p2 sit in the first slot of their side, p3/p4 in the second.
  const selfLoc = seat === 'p1' || seat === 'p2' ? -1 : -2;
  const partnerLoc = selfLoc === -1 ? -2 : -1;
  const targetsFor = (m: RequestMove): { label: string; loc: number }[] => {
    switch (m.target) {
      case 'adjacentAlly':
        return [{ label: 'Partner', loc: partnerLoc }];
      case 'adjacentAllyOrSelf':
        return [
          { label: 'Self', loc: selfLoc },
          { label: 'Partner', loc: partnerLoc },
        ];
      case 'adjacentFoe':
        return [
          { label: 'Foe 1', loc: 1 },
          { label: 'Foe 2', loc: 2 },
        ];
      default:
        return [
          { label: 'Foe 1', loc: 1 },
          { label: 'Foe 2', loc: 2 },
          { label: 'Partner', loc: partnerLoc },
        ];
    }
  };
  const teraSuffix = tera ? ' terastallize' : '';
  const picked = pendingMove !== undefined ? active.moves[pendingMove] : undefined;

  return (
    <div className="card">
      {teamList}
      <p>What will {monName(team.findIndex((p) => p.active))} do?</p>
      <div className="row">
        {active.moves.map((m, i) => (
          <button
            key={m.id}
            className={pendingMove === i ? 'selected' : ''}
            disabled={!!m.disabled || m.pp === 0}
            onClick={() => {
              if (TARGETED_MOVES.has(m.target)) setPendingMove(i);
              else onChoose(`move ${i + 1}${teraSuffix}`);
            }}
          >
            {m.move} <span className="muted">{m.pp}/{m.maxpp}</span>
          </button>
        ))}
      </div>
      {picked && pendingMove !== undefined && (
        <div className="row" style={{ marginTop: 8 }}>
          <span>Target for {picked.move}:</span>
          {targetsFor(picked).map((t) => (
            <button key={t.loc} className="primary" onClick={() => onChoose(`move ${pendingMove + 1} ${t.loc}${teraSuffix}`)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {active.canTerastallize && (
        <label className="row" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={tera} onChange={(e) => setTera(e.target.checked)} />
          Terastallize ({active.canTerastallize})
        </label>
      )}
      {!active.trapped && <div className="row" style={{ marginTop: 8 }}>{switchButtons}</div>}
    </div>
  );
}

function Log({ lines, lobby }: { lines: string[]; lobby?: LobbyState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines]);
  const names = Object.fromEntries(SEATS.map((s) => [s, lobby?.seats[s]?.name ?? s])) as Record<SeatId, string>;
  const entries = formatLog(lines, names);
  return (
    <div className="card log" ref={ref}>
      {entries.length === 0 && <span className="muted">Battle log will appear here.</span>}
      {entries.map((e, i) => (
        <div key={i} className={e.kind === 'turn' ? 'turn' : ''}>
          {e.text}
        </div>
      ))}
    </div>
  );
}
