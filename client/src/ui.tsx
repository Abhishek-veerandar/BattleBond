import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

/** Design size of every screen. The stage scales to fit the window, like a game would. */
export const STAGE_W = 1440;
export const STAGE_H = 900;

export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div className="stage-wrap">
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/** Re-render every `ms` milliseconds; returns performance.now(). */
export function useNow(ms = 250) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const SPRITE_BASE = 'https://play.pokemonshowdown.com/sprites';

/**
 * A Pokémon sprite from Pokémon Showdown's sprite server: the animated 3D
 * sprite when there is one, else the static one, else a name box.
 */
export function Sprite({ id, name, back, size }: { id: string; name: string; back?: boolean; size: number }) {
  const sources = back
    ? [`${SPRITE_BASE}/ani-back/${id}.gif`, `${SPRITE_BASE}/gen5-back/${id}.png`]
    : [`${SPRITE_BASE}/ani/${id}.gif`, `${SPRITE_BASE}/gen5/${id}.png`];
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [id, back]);

  if (index >= sources.length) {
    return (
      <div className="sprite-missing" style={{ width: size, height: size }}>
        {name}
      </div>
    );
  }
  return (
    <img
      className={index === 1 ? 'sprite pixel' : 'sprite'}
      src={sources[index]}
      alt={name}
      style={{ maxWidth: size, maxHeight: size, ...(index === 1 ? { width: size * 0.8 } : {}) }}
      onError={() => setIndex((i) => i + 1)}
      draggable={false}
    />
  );
}

export const TYPE_COLORS: Record<string, string> = {
  Normal: '#A8A77A',
  Fire: '#EE8130',
  Water: '#6390F0',
  Electric: '#F7D02C',
  Grass: '#7AC74C',
  Ice: '#96D9D6',
  Fighting: '#C22E28',
  Poison: '#A33EA1',
  Ground: '#E2BF65',
  Flying: '#A98FF3',
  Psychic: '#F95587',
  Bug: '#A6B91A',
  Rock: '#B6A136',
  Ghost: '#735797',
  Dragon: '#6F35FC',
  Dark: '#705746',
  Steel: '#B7B7CE',
  Fairy: '#D685AD',
  Stellar: '#40B5A5',
};

export function hpColor(percent: number) {
  if (percent > 50) return 'var(--hp-high)';
  if (percent > 20) return 'var(--hp-mid)';
  return 'var(--hp-low)';
}

export function HpBar({ percent, height = 10 }: { percent: number; height?: number }) {
  return (
    <div className="hp" style={{ height }}>
      <div style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: hpColor(percent) }} />
    </div>
  );
}
