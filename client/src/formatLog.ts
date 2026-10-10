import type { SeatId } from '@tagteam/shared';

// Turns Showdown protocol lines into short readable text.
// Lines we don't recognise are skipped, except a few kept raw for debugging.

export interface LogEntry {
  kind: 'turn' | 'line';
  text: string;
}

/** "p2a: Tornadus" → "Tornadus (Gary)" */
function who(ident: string | undefined, names: Record<SeatId, string>) {
  if (!ident) return '?';
  const [pos, mon] = ident.split(': ');
  const seat = pos.slice(0, 2) as SeatId;
  return `${mon ?? pos} (${names[seat] ?? seat})`;
}

export function formatLog(lines: string[], names: Record<SeatId, string>): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.slice(1).split('|');
    const [cmd, a, b, c] = parts;
    const add = (text: string) => out.push({ kind: 'line', text });
    switch (cmd) {
      case 'turn':
        out.push({ kind: 'turn', text: `— Turn ${a} —` });
        break;
      case 'switch':
      case 'drag':
        add(`${who(a, names)} entered the battle (${c?.split(' ')[0] ?? ''} HP)`);
        break;
      case 'move':
        add(`${who(a, names)} used ${b}${c ? ` on ${who(c, names)}` : ''}`);
        break;
      case '-damage':
        add(`  ${who(a, names)} → ${b?.split(' ')[0]} HP`);
        break;
      case '-heal':
        add(`  ${who(a, names)} healed → ${b?.split(' ')[0]} HP`);
        break;
      case 'faint':
        add(`  ${who(a, names)} fainted!`);
        break;
      case '-supereffective':
        add(`  It's super effective!`);
        break;
      case '-resisted':
        add(`  It's not very effective…`);
        break;
      case '-immune':
        add(`  It doesn't affect ${who(a, names)}`);
        break;
      case '-crit':
        add(`  A critical hit!`);
        break;
      case '-miss':
        add(`  ${who(a, names)}'s attack missed`);
        break;
      case '-fail':
        add(`  But it failed`);
        break;
      case '-activate':
      case '-singleturn':
        if (b?.includes('Protect')) add(`  ${who(a, names)} protected itself`);
        break;
      case '-terastallize':
        add(`  ${who(a, names)} terastallized into ${b}!`);
        break;
      case '-boost':
        add(`  ${who(a, names)}'s ${b} rose`);
        break;
      case '-unboost':
        add(`  ${who(a, names)}'s ${b} fell`);
        break;
      case '-status':
        add(`  ${who(a, names)} is now ${b}`);
        break;
      case 'cant':
        add(`  ${who(a, names)} can't move (${b})`);
        break;
      case '-weather':
        if (a !== 'none' && !line.includes('[upkeep]')) add(`  Weather: ${a}`);
        break;
      case 'win':
        add(`${a} won the battle!`);
        break;
      case 'tie':
        add(`The battle ended in a tie.`);
        break;
      case 'error':
        add(`Error: ${parts.slice(1).join('|')}`);
        break;
    }
  }
  return out;
}
