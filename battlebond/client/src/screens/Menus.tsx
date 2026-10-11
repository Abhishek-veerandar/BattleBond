import { useState } from 'react';
import { SEATS, partnerOf, sideOf, type SeatId } from '@tagteam/shared';
import type { Game } from '../net';

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="glow" style={{ left: -200, top: -300, width: 1100, height: 1100, background: 'radial-gradient(circle, rgba(124,58,255,0.55) 0%, rgba(124,58,255,0) 65%)' }} />
      <div className="glow" style={{ right: -260, bottom: -360, width: 1000, height: 1000, background: 'radial-gradient(circle, rgba(255,122,26,0.35) 0%, rgba(255,122,26,0) 65%)' }} />
      <div className="beam" style={{ left: 380, width: 120, background: 'rgba(255,255,255,0.04)' }} />
      <div className="beam" style={{ left: 540, width: 40, background: 'rgba(255,138,31,0.10)' }} />
      <div className="beam" style={{ left: 1020, width: 220, background: 'rgba(34,211,255,0.05)' }} />
    </div>
  );
}

export function Logo({ size = 190 }: { size?: number }) {
  return (
    <div style={{ transform: 'skewX(-8deg)', transformOrigin: 'left top' }}>
      <div className="display" style={{ fontSize: size, fontWeight: 700, lineHeight: 0.78 }}>BATTLE</div>
      <div className="display" style={{ fontSize: size, fontWeight: 700, lineHeight: 0.78, color: 'var(--ally)' }}>BOND</div>
    </div>
  );
}

function BondMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <circle cx="14" cy="18" r="10" stroke="var(--you)" strokeWidth="3.5" />
      <circle cx="22" cy="18" r="10" stroke="var(--ally)" strokeWidth="3.5" />
    </svg>
  );
}

const TIPS = [
  'Ping "Focus right" and your partner sees exactly which foe to hit.',
  'Your moves only go in once you AND your partner lock in.',
  'Watch for spread moves like Earthquake: they hit your partner too.',
  'Run out of time and whatever you planned gets locked for you.',
];

export function TitleScreen({ game }: { game: Game }) {
  const { state } = game;
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('battlebond.name') ?? '';
    } catch {
      return '';
    }
  });
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const connecting = state.phase === 'connecting';

  function play() {
    try {
      localStorage.setItem('battlebond.name', name);
    } catch {
      // ignore
    }
    void game.join(name);
  }

  return (
    <>
      <Backdrop />
      <div className="abs" style={{ left: 48, top: 32, display: 'flex', alignItems: 'center', gap: 10 }}>
        <BondMark />
        <span className="display" style={{ fontSize: 22, letterSpacing: '0.18em', color: 'var(--muted)' }}>TAG BATTLE</span>
      </div>

      <div className="abs" style={{ left: 48, top: 110 }}>
        <Logo />
      </div>
      <p className="abs" style={{ left: 56, top: 440, margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '0.04em', color: '#E6E0FF' }}>
        Two trainers. One team. Win it together.
      </p>

      <div className="abs" style={{ left: 56, top: 500, width: 520, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ color: 'var(--muted)', fontSize: 16, lineHeight: 1.5 }}>
          For now every room is one 2v2 battle with sample teams. Open this page in 4 tabs (tabs 1 &amp; 3 are partners),
          or join once and fill the empty seats with bots.
        </span>
      </div>

      <form
        className="abs"
        aria-label="Join a battle"
        style={{ right: 48, top: 240, width: 400, display: 'flex', flexDirection: 'column', gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!connecting) play();
        }}
      >
        <div className="slant" style={{ background: 'var(--panel)', padding: '18px 34px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="trainer-name" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--muted)' }}>
            TRAINER NAME
          </label>
          <input
            id="trainer-name"
            className="input display"
            style={{ fontSize: 30 }}
            maxLength={16}
            placeholder="ASH"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="slant"
          disabled={connecting}
          style={{ height: 128, padding: '0 40px', background: 'var(--ally)', color: 'var(--ally-ink)', textAlign: 'left', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
        >
          <span className="display" style={{ fontSize: 84, fontWeight: 700 }}>{connecting ? 'JOINING…' : 'PLAY'}</span>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.08em' }}>2V2 TAG BATTLE</span>
        </button>
        {state.error && (
          <p role="alert" style={{ margin: 0, padding: '10px 16px', background: 'rgba(248,113,113,0.18)', color: '#FFD0D0', fontSize: 14 }}>
            {state.error}
          </p>
        )}
      </form>

      <div className="abs" style={{ left: 0, bottom: 0, width: 1440, height: 52, background: 'rgba(8,3,24,0.9)', display: 'flex', alignItems: 'center', gap: 16, padding: '0 48px' }}>
        <span className="display" style={{ padding: '2px 12px', background: 'var(--ally)', color: 'var(--ally-ink)', fontSize: 22, fontWeight: 700 }}>TIP</span>
        <span style={{ color: '#E6E0FF', fontSize: 16 }}>{tip}</span>
      </div>
    </>
  );
}

export function LobbyScreen({ game }: { game: Game }) {
  const { state } = game;
  const me = state.seat;
  const seats = state.lobby?.seats;
  const filled = SEATS.filter((s) => seats?.[s]).length;

  const banner = (seat: SeatId) => {
    const info = seats?.[seat];
    const mine = me && sideOf(seat) === sideOf(me);
    const color = !mine ? 'var(--foe)' : seat === me ? 'var(--you)' : 'var(--ally)';
    const role = !me ? '' : seat === me ? 'YOU' : seat === partnerOf[me] ? 'PARTNER' : 'RIVAL';
    return (
      <div
        key={seat}
        className="slant-l"
        style={{ padding: '18px 30px', background: info ? 'rgba(30,16,70,0.92)' : 'rgba(30,16,70,0.45)', borderLeft: `6px solid ${color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
      >
        <span className="display" style={{ fontSize: 46, fontWeight: 700, color: info ? 'var(--ink)' : '#8C82B5' }}>
          {info ? info.name.toUpperCase() : 'OPEN SEAT'}
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.1em', color }}>
          {info?.bot ? 'BOT' : role}
        </span>
      </div>
    );
  };

  const myTeam = me ? SEATS.filter((s) => sideOf(s) === sideOf(me)) : ['p1', 'p3'];
  const rivals = me ? SEATS.filter((s) => sideOf(s) !== sideOf(me)) : ['p2', 'p4'];

  return (
    <>
      <Backdrop />
      <div className="abs" style={{ left: 48, top: 28, right: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="btn slant" style={{ height: 52 }} onClick={game.leave}>BACK</button>
        <span className="display" style={{ fontSize: 56, fontWeight: 700, transform: 'skewX(-8deg)' }}>PARTY LOBBY</span>
        <span style={{ width: 150, textAlign: 'right', color: 'var(--muted)', fontWeight: 700 }}>{filled} / 4</span>
      </div>

      <section aria-label="Your side" className="abs" style={{ left: 48, top: 170, width: 620, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span className="display" style={{ fontSize: 34, color: 'var(--you)' }}>YOUR SIDE</span>
        {(myTeam as SeatId[]).map(banner)}
      </section>

      <div className="abs display" aria-hidden="true" style={{ left: 680, top: 300, width: 80, textAlign: 'center', fontSize: 96, fontWeight: 700, color: 'var(--muted)' }}>VS</div>

      <section aria-label="Rivals" className="abs" style={{ left: 772, top: 170, width: 620, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span className="display" style={{ fontSize: 34, color: 'var(--foe)' }}>RIVALS</span>
        {(rivals as SeatId[]).map(banner)}
      </section>

      <div className="abs" style={{ left: 0, bottom: 0, width: 1440, height: 120, background: 'rgba(8,3,24,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 48px' }}>
        <span className="display" style={{ fontSize: 30 }}>
          {filled < 4 ? 'WAITING FOR TRAINERS… THE BATTLE STARTS WHEN ALL 4 SEATS ARE FILLED' : 'STARTING…'}
        </span>
        <button
          className="slant display"
          onClick={game.fillBots}
          disabled={filled >= 4}
          style={{ height: 84, width: 440, background: 'var(--you)', color: 'var(--you-ink)', fontSize: 46, fontWeight: 700 }}
        >
          FILL WITH BOTS
        </button>
      </div>
    </>
  );
}
