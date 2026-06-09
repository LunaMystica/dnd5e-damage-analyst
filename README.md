# DnD5e Damage Analyst

A [FoundryVTT](https://foundryvtt.com/) module for the **D&D 5e** system that opens an analysis dialog showing damage-per-round (DPR) and average damage/healing for any actor.

Set a target AC, crit threshold, and save DC, then assign use counts to weapons, spells, and cantrips to see per-item and total expected output.

## Features

- **Single-target DPR analysis** — combines hit chance, crit chance, and average damage into expected damage per round.
- **Four calculation paths** covering every dnd5e action shape:
  - Attack rolls — hit chance × average damage + crit chance × crit bonus
  - Saving throws — fail chance × full damage + pass chance × half/no damage
  - Healing — average with min/max range
  - Direct damage — average damage with no attack or save gate
- **Adjustable parameters** — target AC, crit threshold, and a save DC override.
- **Use counts** — weight each weapon/spell/cantrip by how often it is used per round to get a meaningful total.
- **Group actor support** — per-member tabs for analyzing a whole party.
- Reads scaled, resolved damage formulas (substitutes `@mod`, `@prof`, etc.), so displayed numbers reflect the actual actor.

## Compatibility

| | |
|---|---|
| FoundryVTT | v12+ (verified on v13) |
| Game system | `dnd5e` only |

Supports both the dnd5e v4+ activities API and the v3 legacy data model.

## Installation

**Manifest URL** (paste into Foundry's *Install Module* dialog):

```
https://github.com/LunaMystica/dnd5e-damage-analyst/releases/latest/download/module.json
```

Or download `module.zip` from the [latest release](https://github.com/LunaMystica/dnd5e-damage-analyst/releases/latest) and extract it into your `Data/modules/` directory.

## Usage

1. Enable the module in **Manage Modules** for your world.
2. Open the **Actors** sidebar and click the **Damage Analyst** button, or use the analyst button on an actor sheet.
3. Set the target AC, crit threshold, and save DC.
4. Enter use counts for the weapons, spells, and cantrips you want to include.
5. Read the per-item and total DPR / average damage figures.

## License

See [LICENSE](LICENSE) if present, otherwise all rights reserved by the author.
