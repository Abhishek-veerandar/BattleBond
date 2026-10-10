import type { SeatId } from '@tagteam/shared';

// Hardcoded teams for M1. Side A = p1 + p3, side B = p2 + p4.
// Showdown export format, level 50 doubles-style sets.

export const SAMPLE_TEAMS: Record<SeatId, string> = {
  p1: `
Incineroar @ Sitrus Berry
Ability: Intimidate
Level: 50
Tera Type: Ghost
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Knock Off
- Parting Shot

Amoonguss @ Rocky Helmet
Ability: Regenerator
Level: 50
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Relaxed Nature
- Spore
- Rage Powder
- Pollen Puff
- Protect

Garchomp @ Clear Amulet
Ability: Rough Skin
Level: 50
Tera Type: Steel
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Protect
`,
  p3: `
Rillaboom @ Assault Vest
Ability: Grassy Surge
Level: 50
Tera Type: Fire
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Fake Out
- Grassy Glide
- Wood Hammer
- U-turn

Flutter Mane @ Choice Specs
Ability: Protosynthesis
Level: 50
Tera Type: Fairy
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Moonblast
- Shadow Ball
- Dazzling Gleam
- Mystical Fire

Arcanine @ Safety Goggles
Ability: Intimidate
Level: 50
Tera Type: Normal
EVs: 252 HP / 252 Atk / 4 Spe
Adamant Nature
- Flare Blitz
- Extreme Speed
- Snarl
- Protect
`,
  p2: `
Urshifu-Rapid-Strike @ Mystic Water
Ability: Unseen Fist
Level: 50
Tera Type: Water
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Surging Strikes
- Close Combat
- Aqua Jet
- Protect

Tornadus @ Covert Cloak
Ability: Prankster
Level: 50
Tera Type: Dark
EVs: 252 HP / 4 SpA / 252 Spe
Timid Nature
- Tailwind
- Bleakwind Storm
- Taunt
- Protect

Kingambit @ Black Glasses
Ability: Defiant
Level: 50
Tera Type: Dark
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Protect
`,
  p4: `
Gholdengo @ Life Orb
Ability: Good as Gold
Level: 50
Tera Type: Steel
EVs: 4 HP / 252 SpA / 252 Spe
Modest Nature
- Make It Rain
- Shadow Ball
- Nasty Plot
- Protect

Dragonite @ Choice Band
Ability: Inner Focus
Level: 50
Tera Type: Normal
EVs: 252 HP / 252 Atk / 4 Spe
Adamant Nature
- Extreme Speed
- Dragon Claw
- Fire Punch
- Iron Head

Pelipper @ Damp Rock
Ability: Drizzle
Level: 50
Tera Type: Ground
EVs: 252 HP / 4 Def / 252 SpA
Modest Nature
- Hurricane
- Weather Ball
- Tailwind
- Protect
`,
};
