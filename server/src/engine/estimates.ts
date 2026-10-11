import { Dex } from '@pkmn/sim';
import { calculate, Field, Generations, Move as CalcMove, Pokemon as CalcPokemon } from '@smogon/calc';
import { foesOf, partnerOf, type CalcMsg, type MoveInfo, type SeatId } from '@tagteam/shared';
import type { TagTeamBattle } from './TagTeamBattle';

/**
 * Damage estimates for the move buttons.
 *
 * Fairness rule: for a foe we only use what every player can see (species,
 * stat boosts, status, Tera type, field effects). Their real EVs, item and
 * nature stay hidden, so foes are modelled as a plain set: no item, neutral
 * nature, no EVs. That makes the numbers an estimate, which is how the UI
 * labels them. Your own Pokémon and your partner's use their exact sets,
 * since the two of you built the team together.
 */

const gen = Generations.get(9);

const WEATHER: Record<string, string> = {
  raindance: 'Rain',
  primordialsea: 'Heavy Rain',
  sunnyday: 'Sun',
  desolateland: 'Harsh Sunshine',
  sandstorm: 'Sand',
  snow: 'Snow',
  snowscape: 'Snow',
  hail: 'Hail',
  deltastream: 'Strong Winds',
};

const TERRAIN: Record<string, string> = {
  electricterrain: 'Electric',
  grassyterrain: 'Grassy',
  psychicterrain: 'Psychic',
  mistyterrain: 'Misty',
};

// The simulator's Pokémon type isn't exported in a stable way, so we describe the bits we read.
interface SimMon {
  species: { name: string; abilities: Record<string, string> };
  level: number;
  hp: number;
  fainted: boolean;
  status: string;
  boosts: Record<string, number>;
  terastallized?: string;
  set: { item?: string; ability?: string; nature?: string; evs?: Record<string, number>; ivs?: Record<string, number> };
  getAbility(): { name: string };
  getItem(): { name: string };
}

function toCalcMon(mon: SimMon, exact: boolean) {
  const b = mon.boosts ?? {};
  const options: Record<string, unknown> = {
    level: mon.level,
    boosts: { atk: b.atk ?? 0, def: b.def ?? 0, spa: b.spa ?? 0, spd: b.spd ?? 0, spe: b.spe ?? 0 },
    status: mon.status || '',
  };
  if (exact) {
    options.item = mon.getItem()?.name || mon.set.item || undefined;
    options.ability = mon.getAbility()?.name || mon.set.ability || undefined;
    options.nature = mon.set.nature || 'Serious';
    options.evs = mon.set.evs;
    options.ivs = mon.set.ivs;
  } else {
    options.ability = mon.species.abilities?.['0'];
    options.nature = 'Serious';
  }
  if (mon.terastallized) options.teraType = mon.terastallized;
  return new CalcPokemon(gen, mon.species.name, options as ConstructorParameters<typeof CalcPokemon>[2]);
}

function screensOn(engine: TagTeamBattle, seat: SeatId) {
  // Partners each have a Side in a multi battle; a screen set by either protects both.
  const ids = new Set<string>();
  for (const s of [seat, partnerOf[seat]]) {
    for (const id of Object.keys(engine.side(s)?.sideConditions ?? {})) ids.add(id);
  }
  return { isReflect: ids.has('reflect'), isLightScreen: ids.has('lightscreen'), isAuroraVeil: ids.has('auroraveil') };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function moveInfo(id: string): MoveInfo {
  const m = Dex.moves.get(id);
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    category: m.category as MoveInfo['category'],
    basePower: m.basePower,
    target: m.target,
  };
}

/** Estimates for every move of `seat`'s active Pokémon against every other active Pokémon. */
export function buildCalc(engine: TagTeamBattle, seat: SeatId): CalcMsg {
  const request = engine.requests[seat];
  const slot = request?.active?.[0];
  const attackerSim = engine.active(seat) as unknown as SimMon | undefined;
  if (!request || !slot || !attackerSim || attackerSim.fainted) {
    return { rqid: request?.rqid, moves: [], estimates: [] };
  }

  const moves = slot.moves.map((m) => moveInfo(m.id));
  const field = engine.battle.field;
  const targets: SeatId[] = [...foesOf(seat), partnerOf[seat]];

  let attacker: CalcPokemon;
  try {
    attacker = toCalcMon(attackerSim, true);
  } catch (err) {
    console.warn('[estimates] could not model attacker', err);
    return { rqid: request.rqid, moves, estimates: moves.map(() => ({})) };
  }

  const estimates = moves.map((move) => {
    const out: CalcMsg['estimates'][number] = {};
    if (move.category === 'Status') return out;
    for (const target of targets) {
      const defSim = engine.active(target) as unknown as SimMon | undefined;
      if (!defSim || defSim.fainted || defSim.hp <= 0) continue;
      try {
        const defender = toCalcMon(defSim, target === partnerOf[seat]);
        const calcField = new Field({
          gameType: 'Doubles',
          weather: WEATHER[field.weather] as never,
          terrain: TERRAIN[field.terrain] as never,
          defenderSide: screensOn(engine, target),
        });
        const result = calculate(gen, attacker, defender, new CalcMove(gen, move.name), calcField);
        const [lo, hi] = result.range();
        const maxHP = defender.maxHP();
        if (maxHP > 0 && hi > 0) out[target] = [round1((lo / maxHP) * 100), round1((hi / maxHP) * 100)];
      } catch {
        // A move the calculator can't model just shows no estimate.
      }
    }
    return out;
  });

  return { rqid: request.rqid, moves, estimates };
}
