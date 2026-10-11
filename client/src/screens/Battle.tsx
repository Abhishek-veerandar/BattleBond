import { useEffect, useState } from 'react';
import {
  PING_LABELS,
  SEATS,
  TARGETED_MOVES,
  foesOf,
  nameOfIdent,
  partnerLoc,
  partnerOf,
  selfLoc,
  sideOf,
  speciesOf,
  type FieldMon,
  type PingType,
  type RequestPokemon,
  type SeatId,
  type SeatPlan,
} from '@tagteam/shared';
import type { Game } from '../net';
import { HpBar, Sprite, TYPE_COLORS, useNow } from '../ui';
import { formatLog } from '../formatLog';

// Where each slot stands on the 1440x900 stage (sprite centres).
const POS = {
  F1: { x: 960, y: 290 },
  F2: { x: 1215, y: 255 },
  A: { x: 300, y: 560 },
  B: { x: 640, y: 525 },
};
const FOE_SIZE = 170;
const ALLY_SIZE = 230;

function parseCondition(condition: string) {
  if (condition.endsWith(' fnt')) return { hp: 0, max: 0, percent: 0, fainted: true, status: '' };
  const [hpPart, status = ''] = condition.split(' ');
  const [hp, max] = hpPart.split('/').map(Number);
  return { hp, max, percent: max ? (hp / max) * 100 : 0, fainted: false, status };
}

const fmtRange = ([a, b]: [number, number]) => `${Math.round(a)}–${Math.round(b)}%`;

const STATUS_LABEL: Record<string, string> = { brn: 'BRN', par: 'PAR', slp: 'SLP', frz: 'FRZ', psn: 'PSN', tox: 'TOX' };

export function BattleScreen({ game }: { game: Game }) {
  const { state } = game;
  const now = useNow(200);
  const me = state.seat!;
  const partner = partnerOf[me];
  const [f1, f2] = foesOf(me);
  const slotA = selfLoc(me) === -1 ? me : partner;
  const posOf = (s: SeatId) => (s === f1 ? POS.F1 : s === f2 ? POS.F2 : s === slotA ? POS.A : POS.B);
  const nameOf = (s: SeatId) => state.lobby?.seats[s]?.name ?? s.toUpperCase();

  const { field, request: req, calc, plan } = state;
  const active = req?.active?.[0];
  const team = req?.side.pokemon ?? [];
  const activeIdx = team.findIndex((p) => p.active);
  const you = plan?.you;
  const ally = plan?.partner;

  const [pendingMove, setPendingMove] = useState<number | null>(null);
  const [tera, setTera] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [chatText, setChatText] = useState('');

  // New decision: clear local picks.
  useEffect(() => {
    setPendingMove(null);
    setTera(false);
    setShowSwitch(false);
  }, [req?.rqid]);

  const kind: 'wait' | 'preview' | 'switch' | 'move' =
    !req || req.wait ? 'wait' : req.teamPreview ? 'preview' : req.forceSwitch?.some(Boolean) ? 'switch' : 'move';
  const youLocked = !!you?.locked;
  const submitted = youLocked && !!you?.idle;
  const frozen = youLocked; // can't change picks while locked

  const mon = (s: SeatId): FieldMon | null => field?.mons[s] ?? null;
  const alive = (s: SeatId) => {
    const m = mon(s);
    return !!m && !m.fainted;
  };

  // ----- choices -----
  const moveChoice = (i: number, loc?: number, withTera = tera) =>
    `move ${i + 1}${loc !== undefined ? ` ${loc}` : ''}${withTera ? ' terastallize' : ''}`;

  const targetsFor = (target: string): { loc: number; seat: SeatId; label: string }[] => {
    const foeT = [
      { loc: 1, seat: f1, label: 'FOE LEFT' },
      { loc: 2, seat: f2, label: 'FOE RIGHT' },
    ];
    const allyT = { loc: partnerLoc(me), seat: partner, label: 'PARTNER' };
    const selfT = { loc: selfLoc(me), seat: me, label: 'SELF' };
    const list =
      target === 'adjacentFoe'
        ? foeT
        : target === 'adjacentAlly'
          ? [allyT]
          : target === 'adjacentAllyOrSelf'
            ? [selfT, allyT]
            : [...foeT, allyT];
    return list.filter((t) => t.seat === me || alive(t.seat));
  };

  function clickMove(i: number) {
    if (!active || frozen) return;
    const m = active.moves[i];
    if (TARGETED_MOVES.has(m.target)) {
      const targets = targetsFor(m.target);
      if (targets.length === 1) {
        game.intent(moveChoice(i, targets[0].loc));
        setPendingMove(null);
      } else setPendingMove(i);
    } else {
      game.intent(moveChoice(i));
      setPendingMove(null);
    }
  }

  function pickTarget(loc: number) {
    if (pendingMove === null) return;
    game.intent(moveChoice(pendingMove, loc));
    setPendingMove(null);
  }

  function toggleTera() {
    const next = !tera;
    setTera(next);
    // Re-send the current move pick with or without Tera.
    const c = you?.intent?.choice;
    const m = c ? /^move (\d)(?: (-?\d))?/.exec(c) : null;
    if (m && !frozen) game.intent(moveChoice(Number(m[1]) - 1, m[2] !== undefined ? Number(m[2]) : undefined, next));
  }

  const selectedMove = (() => {
    const m = you?.intent?.kind === 'move' ? /^move (\d)/.exec(you.intent.choice) : null;
    return m ? Number(m[1]) - 1 : null;
  })();

  // ----- KO read-out: your hit + your partner's hit on the same foe -----
  const koVerdict = (foe: SeatId): { text: string; strong: boolean } | null => {
    const m = mon(foe);
    if (!m || m.fainted) return null;
    const parts = [you, ally].filter((p): p is SeatPlan => !!p?.intent?.hits?.includes(foe) && !!p.estimates?.[foe]);
    if (!parts.length) return null;
    const lo = parts.reduce((s, p) => s + p.estimates![foe]![0], 0);
    const hi = parts.reduce((s, p) => s + p.estimates![foe]![1], 0);
    if (lo >= m.hpPercent) return { text: parts.length > 1 ? 'LIKELY KO TOGETHER' : 'LIKELY KO', strong: true };
    if (hi >= m.hpPercent) return { text: parts.length > 1 ? 'POSSIBLE KO TOGETHER' : 'POSSIBLE KO', strong: true };
    return { text: `≈ ${Math.round(lo)}–${Math.round(hi)}%`, strong: false };
  };

  const hitsPartner = !!you?.intent?.hits?.includes(partner);
  const partnerHitsMe = !!ally?.intent?.hits?.includes(me);

  // ----- timer -----
  const secs = state.timer ? Math.max(0, Math.ceil((state.timer.deadline - now) / 1000)) : null;
  const timerFrac = state.timer ? Math.max(0, (state.timer.deadline - now) / state.timer.totalMs) : 0;

  // ----- recent team pings / chat -----
  const recentTeam = state.team.filter((e) => now - e.at < 9000).slice(-3);
  const names = Object.fromEntries(SEATS.map((s) => [s, nameOf(s)])) as Record<SeatId, string>;
  const ticker = formatLog(state.log, names).slice(-5);

  const myActive = activeIdx >= 0 ? team[activeIdx] : undefined;
  const myCond = myActive ? parseCondition(myActive.condition) : null;

  const allyStatus = (() => {
    if (!ally) return 'CONNECTING…';
    if (ally.locked && ally.idle) return 'LOCKED IN';
    if (ally.locked) return `LOCKED · ${ally.intent?.label.toUpperCase() ?? ''}`;
    if (ally.idle) return 'NOTHING TO PICK';
    if (ally.intent) return `PLANNING · ${ally.intent.label.toUpperCase()}`;
    return 'THINKING…';
  })();

  const mySide = sideOf(me);
  const foeSide = mySide === 'A' ? 'B' : 'A';
  const iWon = state.end && state.end.winner === mySide;

  return (
    <>
      {/* ---------- arena ---------- */}
      <div className="backdrop" aria-hidden="true" style={{ background: 'linear-gradient(180deg, #1B0D4A 0%, #2A1263 45%, #3A1A5E 60%, #1A0B33 100%)' }}>
        <div className="glow" style={{ left: -200, top: 520, width: 1840, height: 600, background: 'radial-gradient(ellipse at center, rgba(124,58,255,0.35) 0%, rgba(124,58,255,0) 60%)' }} />
        <div className="abs" style={{ left: 0, top: 470, width: 1440, height: 2, background: 'linear-gradient(90deg, rgba(34,211,255,0), rgba(34,211,255,0.6), rgba(255,138,31,0.6), rgba(255,138,31,0))' }} />
        {[f1, f2].map((s) => (
          <div key={s} className="platform" style={{ left: posOf(s).x, top: posOf(s).y + 72, width: 230, height: 56, background: 'rgba(255,92,122,0.16)', border: '2px solid rgba(255,92,122,0.55)' }} />
        ))}
        {[me, partner].map((s) => (
          <div key={s} className="platform" style={{ left: posOf(s).x, top: posOf(s).y + 100, width: 300, height: 74, background: s === me ? 'rgba(34,211,255,0.18)' : 'rgba(255,138,31,0.14)', border: `2px solid ${s === me ? 'rgba(34,211,255,0.7)' : 'rgba(255,138,31,0.55)'}` }} />
        ))}
      </div>

      {/* ---------- sprites ---------- */}
      {SEATS.map((s) => {
        const m = mon(s);
        if (!m || m.fainted) return null;
        const foe = s === f1 || s === f2;
        const size = foe ? FOE_SIZE : ALLY_SIZE;
        const p = posOf(s);
        return (
          <div key={`${s}-${m.species}`} className="abs" style={{ left: p.x - size / 2, top: p.y - size / 2, width: size, height: size, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <Sprite id={m.sprite} name={m.species} back={!foe} size={size} />
          </div>
        );
      })}

      {/* ---------- intent arrows ---------- */}
      <svg className="abs" aria-hidden="true" width={1440} height={900} viewBox="0 0 1440 900" style={{ left: 0, top: 0, pointerEvents: 'none' }}>
        <defs>
          <marker id="arr-you" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#22D3FF" /></marker>
          <marker id="arr-ally" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#FF8A1F" /></marker>
        </defs>
        {[you, ally].map((p) => {
          if (!p?.intent || p.intent.kind !== 'move' || !p.intent.hits?.length) return null;
          const from = posOf(p.seat);
          const isYou = p.seat === me;
          return p.intent.hits.map((hit) => {
            const to = posOf(hit);
            const sx = from.x, sy = from.y - 70;
            const ex = to.x + (isYou ? -14 : 14), ey = to.y + (hit === me || hit === partner ? -40 : 30);
            const cx = (sx + ex) / 2, cy = Math.min(sy, ey) - 120;
            return (
              <path
                key={`${p.seat}-${hit}`}
                d={`M${sx} ${sy} Q ${cx} ${cy}, ${ex} ${ey}`}
                fill="none"
                stroke={isYou ? '#22D3FF' : '#FF8A1F'}
                strokeWidth={5}
                strokeDasharray={p.locked ? undefined : '14 10'}
                markerEnd={`url(#${isYou ? 'arr-you' : 'arr-ally'})`}
                opacity={0.95}
              />
            );
          });
        })}
      </svg>

      {/* intent labels */}
      {[you, ally].map((p) => {
        if (!p?.intent) return null;
        const isYou = p.seat === me;
        const from = posOf(p.seat);
        const text = `${isYou ? 'YOU' : p.name.toUpperCase()} · ${p.intent.kind === 'switch' ? `SWITCH → ${p.intent.label.toUpperCase()}` : p.intent.label.toUpperCase()}${p.intent.tera ? ' · TERA' : ''}${!isYou ? (p.locked ? ' · LOCKED' : ' · NOT LOCKED') : ''}`;
        return (
          <div key={`label-${p.seat}`} className="abs tag slant" style={{ left: from.x - 60, top: from.y - 190 - (isYou ? 0 : 34), background: isYou ? 'var(--you)' : 'var(--ally)', color: isYou ? 'var(--you-ink)' : 'var(--ally-ink)', fontSize: 14, whiteSpace: 'nowrap' }}>
            {text}
          </div>
        );
      })}

      {/* KO read-outs over foes */}
      {[f1, f2].map((f) => {
        const v = koVerdict(f);
        if (!v) return null;
        const p = posOf(f);
        return (
          <div key={`ko-${f}`} className="abs tag slant" style={{ left: p.x - 70, top: p.y - FOE_SIZE / 2 - 34, background: v.strong ? '#FFFFFF' : 'var(--panel)', color: v.strong ? 'var(--bg)' : 'var(--ink)', fontSize: 14 }}>
            {v.text} <span style={{ fontWeight: 500, opacity: 0.7 }}>EST.</span>
          </div>
        );
      })}

      {/* target picking */}
      {pendingMove !== null && active && (
        <>
          {targetsFor(active.moves[pendingMove].target).map((t) => {
            const p = posOf(t.seat);
            const foe = t.seat === f1 || t.seat === f2;
            const size = (foe ? FOE_SIZE : ALLY_SIZE) + 30;
            const est = calc?.estimates?.[pendingMove]?.[t.seat];
            return (
              <div key={`t-${t.loc}`}>
                <div className="target-ring" style={{ left: p.x, top: p.y, width: size, height: size, borderColor: foe ? '#fff' : 'var(--ally)' }} />
                <button
                  className="abs"
                  aria-label={`Target ${t.label}: ${mon(t.seat)?.species ?? ''}`}
                  onClick={() => pickTarget(t.loc)}
                  style={{ left: p.x - size / 2, top: p.y - size / 2, width: size, height: size, borderRadius: '50%', background: 'transparent' }}
                />
                {est && (
                  <div className="abs tag" style={{ left: p.x - 50, top: p.y + size / 2 - 6, background: 'var(--panel-dark)' }}>{fmtRange(est)}</div>
                )}
              </div>
            );
          })}
          <div className="abs slant display" style={{ left: 560, top: 150, padding: '6px 32px', background: '#fff', color: 'var(--bg)', fontSize: 30, fontWeight: 700 }}>
            PICK A TARGET FOR {active.moves[pendingMove].move.toUpperCase()}
          </div>
        </>
      )}

      {/* ---------- top HUD ---------- */}
      <div className="abs" aria-hidden="true" style={{ left: 0, top: 0, width: 1440, height: 110, background: 'linear-gradient(180deg, rgba(8,3,24,0.92), rgba(8,3,24,0))' }} />
      <div className="abs" style={{ left: 40, top: 22, display: 'flex', gap: 10, flexWrap: 'wrap', width: 520 }}>
        {field?.weather && <span className="chip slant">{field.weather.toUpperCase()}{field.weatherTurns ? ` · ${field.weatherTurns}` : ''}</span>}
        {field?.terrain && <span className="chip slant">{field.terrain.toUpperCase()}</span>}
        {field?.conditions[mySide].map((c) => (
          <span key={`m-${c.name}`} className="chip slant" style={{ background: 'rgba(34,211,255,0.22)', color: '#BDF3FF' }}>YOUR {c.name.toUpperCase()}{c.turns ? ` · ${c.turns}` : ''}</span>
        ))}
        {field?.conditions[foeSide].map((c) => (
          <span key={`f-${c.name}`} className="chip slant" style={{ background: 'rgba(255,92,122,0.22)', color: '#FFC7D1' }}>FOE {c.name.toUpperCase()}{c.turns ? ` · ${c.turns}` : ''}</span>
        ))}
      </div>

      <div className="abs" role="timer" aria-label={secs !== null ? `${secs} seconds left` : 'Turn timer'} style={{ left: 620, top: 10, width: 200, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--muted)' }}>TURN {field?.turn ?? 0}</span>
        <span className={`display ${secs !== null && secs <= 10 && !submitted ? 'timer-low' : ''}`} style={{ fontSize: 72, fontWeight: 700, lineHeight: 0.8 }}>
          {secs ?? '--'}
        </span>
        <div style={{ width: 180, height: 6, marginTop: 4, background: 'rgba(255,255,255,0.15)' }}>
          <div style={{ width: `${timerFrac * 100}%`, height: '100%', background: secs !== null && secs <= 10 ? 'var(--hp-low)' : '#fff' }} />
        </div>
      </div>

      {/* last few log lines */}
      <div className="abs" aria-live="polite" style={{ left: 470, top: 118, width: 500, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 14, color: '#E6E0FF', textShadow: '0 1px 3px #000', pointerEvents: 'none' }}>
        {ticker.map((e, i) => (
          <span key={i} style={{ opacity: 0.45 + (i / ticker.length) * 0.55, fontWeight: e.kind === 'turn' ? 700 : 500 }}>{e.text}</span>
        ))}
      </div>

      {/* foe plates */}
      <div className="abs" style={{ right: 40, top: 18, width: 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[f1, f2].map((f) => {
          const m = mon(f);
          return (
            <div key={f} className="slant-r" style={{ padding: '8px 18px', background: 'var(--panel-dark)', borderRight: '5px solid var(--foe)', opacity: m?.fainted ? 0.5 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span className="display" style={{ fontSize: 26 }}>
                  {m ? m.species.toUpperCase() : '—'}
                  {m?.status && <span className="tag" style={{ marginLeft: 8, background: '#5B1A2A', fontSize: 12 }}>{STATUS_LABEL[m.status] ?? m.status.toUpperCase()}</span>}
                  {m?.terastallized && <span className="tag" style={{ marginLeft: 8, background: '#2C6E68', fontSize: 12 }}>TERA {m.terastallized.toUpperCase()}</span>}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{nameOf(f).toUpperCase()} · {m?.remaining ?? 0} LEFT</span>
              </div>
              <HpBar percent={m?.hpPercent ?? 0} height={8} />
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{m ? (m.fainted ? 'FAINTED' : `${m.hpPercent}%`) : ''}</div>
            </div>
          );
        })}
      </div>

      {/* ---------- pings + team chat ---------- */}
      <div role="group" aria-label={`Ping ${nameOf(partner)}`} className="abs" style={{ left: 40, top: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--muted)' }}>PING {nameOf(partner).toUpperCase()}</span>
        {(Object.keys(PING_LABELS) as PingType[]).map((p) => (
          <button key={p} className="btn slant-l" onClick={() => game.ping(p)} style={{ width: 196, justifyContent: 'flex-start', padding: '0 18px', fontWeight: 600, color: p === 'spread' ? '#FFD3A1' : undefined }}>
            {PING_LABELS[p]}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (chatText.trim()) game.chat(chatText);
            setChatText('');
          }}
          style={{ display: 'flex', gap: 6, marginTop: 6 }}
        >
          <label htmlFor="team-chat" className="sr-only">Message {nameOf(partner)}</label>
          <input id="team-chat" className="input" style={{ width: 150, height: 44 }} maxLength={140} placeholder="Team chat…" value={chatText} onChange={(e) => setChatText(e.target.value)} />
          <button className="btn" type="submit" style={{ padding: '0 12px' }}>SEND</button>
        </form>
      </div>
      <div className="abs" aria-live="polite" style={{ left: 256, top: 140, width: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {recentTeam.map((e) => {
          const mine = e.from === me;
          return (
            <div key={e.id} className="toast slant-l" style={{ padding: '8px 16px', background: mine ? 'rgba(34,211,255,0.9)' : 'rgba(255,138,31,0.94)', color: mine ? 'var(--you-ink)' : 'var(--ally-ink)', fontWeight: 600 }}>
              <strong>{mine ? 'YOU' : e.fromName.toUpperCase()}:</strong> {e.kind === 'ping' ? <strong>{PING_LABELS[e.ping!].toUpperCase()}</strong> : e.text}
            </div>
          );
        })}
      </div>

      {/* ---------- your side plates ---------- */}
      <div className="abs" style={{ left: 40, top: 732, display: 'flex', gap: 12 }}>
        <div className="slant-l" style={{ width: 330, padding: '10px 22px', background: 'var(--panel-dark)', borderLeft: '6px solid var(--you)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="display" style={{ fontSize: 30 }}>{myActive ? speciesOf(myActive.details).toUpperCase() : '—'}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--you)' }}>YOU{myCond?.status ? ` · ${STATUS_LABEL[myCond.status] ?? myCond.status.toUpperCase()}` : ''}</span>
          </div>
          <HpBar percent={myCond?.percent ?? 0} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 13, color: 'var(--muted)', gap: 8 }}>
            <span>{myCond && !myCond.fainted ? `${myCond.hp} / ${myCond.max}` : myCond?.fainted ? 'FAINTED' : ''}</span>
            <span style={{ textAlign: 'right' }}>
              {team.filter((p) => !p.active).map((p) => `${nameOfIdent(p.ident).toUpperCase()} ${p.condition.endsWith(' fnt') ? 'KO' : `${Math.round(parseCondition(p.condition).percent)}%`}`).join(' · ')}
            </span>
          </div>
          {partnerHitsMe && <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: '#FFB3B3' }}>{nameOf(partner).toUpperCase()}'S {ally?.intent?.label.toUpperCase()} HITS YOU TOO</div>}
        </div>
        <div className="slant-l" style={{ width: 300, padding: '10px 22px', background: 'var(--panel-dark)', borderLeft: '6px solid var(--ally)', opacity: mon(partner)?.fainted ? 0.6 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="display" style={{ fontSize: 30 }}>{mon(partner)?.species.toUpperCase() ?? '—'}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ally)' }}>{nameOf(partner).toUpperCase()}</span>
          </div>
          <HpBar percent={mon(partner)?.hpPercent ?? 0} />
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--muted)' }}>
            {mon(partner)?.fainted ? 'FAINTED' : `${mon(partner)?.hpPercent ?? 0}%`} · <strong style={{ color: '#FFD3A1' }}>{allyStatus}</strong>
          </div>
          {hitsPartner && <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: '#FFB3B3' }}>YOUR {you?.intent?.label.toUpperCase()} HITS {nameOf(partner).toUpperCase()} TOO</div>}
        </div>
      </div>

      {/* ---------- action panel ---------- */}
      <section aria-label="Your action" className="abs" style={{ right: 40, bottom: 26, width: 620, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
        {kind === 'move' && active && !showSwitch && (
          <>
            <div style={{ display: 'flex', gap: 12 }}>
              {active.canTerastallize && (
                <button className="btn slant" aria-pressed={tera} onClick={toggleTera} disabled={frozen} style={tera ? { background: '#40B5A5', color: '#061A18' } : undefined}>
                  TERA {active.canTerastallize.toUpperCase()}
                </button>
              )}
              {!active.trapped && team.some((p) => !p.active && !p.condition.endsWith(' fnt')) && (
                <button className="btn slant" onClick={() => setShowSwitch(true)} disabled={frozen}>SWITCH</button>
              )}
            </div>
            {active.moves.map((m, i) => {
              const info = calc?.moves[i];
              const selected = selectedMove === i;
              const pending = pendingMove === i;
              const disabled = !!m.disabled || m.pp === 0 || frozen;
              const est = calc?.estimates?.[i];
              const foeEst = [f1, f2].map((f) => (est?.[f] ? `${f === f1 ? 'L' : 'R'} ${fmtRange(est[f]!)}` : null)).filter(Boolean).join(' · ');
              const hurtsAlly = info?.target === 'allAdjacent';
              return (
                <button
                  key={m.id}
                  className="slant"
                  onClick={() => clickMove(i)}
                  disabled={disabled}
                  aria-pressed={selected}
                  style={{
                    width: selected || pending ? 440 : 420,
                    height: selected ? 70 : 62,
                    marginRight: [140, 100, 60, 20][i] ?? 0,
                    padding: '0 30px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    background: selected ? 'var(--you)' : pending ? '#FFFFFF' : 'rgba(30,16,70,0.94)',
                    color: selected || pending ? 'var(--you-ink)' : 'var(--ink)',
                    borderLeft: `8px solid ${TYPE_COLORS[info?.type ?? ''] ?? '#888'}`,
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span className="display" style={{ fontSize: selected ? 38 : 34, fontWeight: selected ? 700 : 500 }}>{m.move.toUpperCase()}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>
                      {info ? `${info.type.toUpperCase()} · ${info.category.toUpperCase()}` : ''}
                      {hurtsAlly ? ' · HITS PARTNER' : info?.target === 'allAdjacentFoes' ? ' · BOTH FOES' : ''}
                    </span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 12, fontWeight: 600 }}>
                    <span>{m.pp}/{m.maxpp} PP</span>
                    {foeEst && <span style={{ opacity: 0.85 }}>{foeEst}</span>}
                  </span>
                </button>
              );
            })}
          </>
        )}

        {((kind === 'move' && showSwitch) || kind === 'switch') && (
          <div className="slant" style={{ width: 560, padding: '18px 40px', background: 'rgba(30,16,70,0.96)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="display" style={{ fontSize: 32 }}>{kind === 'switch' ? 'SEND IN A REPLACEMENT' : 'SWITCH TO'}</span>
            {team.map((p, i) => <SwitchOption key={p.ident} p={p} disabled={frozen} selected={you?.intent?.choice === `switch ${i + 1}`} onPick={() => game.intent(`switch ${i + 1}`)} />)}
            {kind === 'move' && (
              <button className="btn" onClick={() => setShowSwitch(false)} style={{ alignSelf: 'flex-start' }}>BACK TO MOVES</button>
            )}
          </div>
        )}

        {kind === 'preview' && (
          <div className="slant" style={{ width: 560, padding: '18px 40px', background: 'rgba(30,16,70,0.96)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="display" style={{ fontSize: 32 }}>CHOOSE YOUR LEAD</span>
            {team.map((p, i) => {
              const order = [i + 1, ...[1, 2, 3].filter((n) => n !== i + 1)].join('');
              const selected = you?.intent?.choice === `team ${order}`;
              return (
                <button key={p.ident} className="btn slant-l" disabled={frozen} onClick={() => game.intent(`team ${order}`)} style={{ justifyContent: 'space-between', height: 56, background: selected ? 'var(--you)' : undefined, color: selected ? 'var(--you-ink)' : undefined }}>
                  <span className="display" style={{ fontSize: 30 }}>{speciesOf(p.details).toUpperCase()}</span>
                  <span style={{ fontSize: 13 }}>{p.item}</span>
                </button>
              );
            })}
          </div>
        )}

        {kind === 'wait' && !state.end && (
          <div className="slant display" style={{ padding: '16px 40px', background: 'var(--panel)', fontSize: 34 }}>WAITING FOR THE OTHER TRAINERS…</div>
        )}

        {kind !== 'wait' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {pendingMove !== null && (
              <button className="btn slant" onClick={() => setPendingMove(null)}>CANCEL</button>
            )}
            {submitted ? (
              <div className="slant display" style={{ width: 320, height: 84, display: 'grid', placeItems: 'center', background: 'var(--panel)', fontSize: 40 }}>LOCKED IN</div>
            ) : youLocked ? (
              <button className="slant display" onClick={game.unlock} style={{ width: 320, height: 84, background: '#FFFFFF', color: 'var(--bg)', fontSize: 44, fontWeight: 700 }}>
                UNLOCK
              </button>
            ) : (
              <button
                className="slant display"
                disabled={!you?.intent || pendingMove !== null}
                onClick={() => you?.intent && game.lock(you.intent.choice)}
                style={{ width: 320, height: 84, background: 'var(--ally)', color: 'var(--ally-ink)', fontSize: 54, fontWeight: 700 }}
              >
                LOCK IN
              </button>
            )}
          </div>
        )}
        {youLocked && !submitted && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>WAITING FOR {nameOf(partner).toUpperCase()} TO LOCK IN</span>
        )}
      </section>

      {/* errors */}
      {state.error && !state.end && (
        <div role="alert" className="abs slant" style={{ left: 420, top: 660, width: 600, padding: '10px 30px', background: 'rgba(248,113,113,0.92)', color: '#2A0606', fontWeight: 700, textAlign: 'center' }}>
          {state.error}
        </div>
      )}

      {/* ---------- result ---------- */}
      {state.end && (
        <div className="overlay">
          <span className="display" style={{ fontSize: 200, fontWeight: 700, transform: 'skewX(-8deg)', color: iWon ? 'var(--you)' : state.end.winner === null ? 'var(--ink)' : 'var(--foe)' }}>
            {state.end.winner === null ? 'DRAW' : iWon ? 'VICTORY' : 'DEFEAT'}
          </span>
          <span style={{ fontSize: 22, color: 'var(--muted)' }}>
            {state.end.winner === null ? 'Nobody wins this one.' : `${state.end.winnerNames} win${iWon ? ' — nice teamwork!' : '.'}`}
          </span>
          <button className="slant display" onClick={game.leave} style={{ width: 420, height: 90, background: 'var(--ally)', color: 'var(--ally-ink)', fontSize: 52, fontWeight: 700 }}>
            BACK TO TITLE
          </button>
        </div>
      )}
    </>
  );
}

function SwitchOption({ p, disabled, selected, onPick }: { p: RequestPokemon; disabled: boolean; selected: boolean; onPick: () => void }) {
  const cond = parseCondition(p.condition);
  if (p.active) return null;
  return (
    <button
      className="btn slant-l"
      disabled={disabled || cond.fainted}
      onClick={onPick}
      aria-pressed={selected}
      style={{ justifyContent: 'space-between', height: 56, gap: 16, background: selected ? 'var(--you)' : undefined, color: selected ? 'var(--you-ink)' : undefined }}
    >
      <span className="display" style={{ fontSize: 30 }}>{speciesOf(p.details).toUpperCase()}</span>
      <span style={{ width: 160, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
        {cond.fainted ? 'FAINTED' : <><HpBar percent={cond.percent} height={8} />{cond.hp} / {cond.max}</>}
      </span>
    </button>
  );
}
