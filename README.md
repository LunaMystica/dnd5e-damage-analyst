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
- **Adjustable parameters** — target AC, crit threshold, a save DC override, and a **Force crits** toggle that treats every attack as a guaranteed critical hit.
- **Use counts with steppers** — `−`/`+` buttons (or type a value) weight each weapon/spell/cantrip by how often it is used per round to get a meaningful total.
- **Weapons, Cantrips, Spells, Features, and Healing tabs** — the **Features** tab covers `feat`-type items (class features, racial traits, monster actions) that deal damage via attack, save, or direct-damage activities.
- **NPC toggle** — by default the actor selector lists player characters and groups; tick **NPCs** to also pick monsters/NPCs, listed in a separate group.
- **Activity names toggle** — append each activity's name to its item (e.g. _Breath Weapon: Fire_). Defaults on for the Features tab; tick it to force activity names on every tab.
- **Range column** — shows each entry's reach/range: _Self_, _Touch_, _Melee_ (5 ft, or 10 ft with the Reach property), or the listed distance such as _60 ft_ or _20/60 ft_.
- **Open actor & Reset** — jump straight to the selected actor's sheet, or reset that actor's (or the whole group's) use counts in one click.
- **Group & temporary-group support** — analyze a saved group actor, or build an ad-hoc **temporary group** from any actors you can access. Per-member tabs plus an **All** tab that combines totals; in the All view each row shows which actor it belongs to. Once a temporary group has more than one member, a **Save as group** button (and the Open-actor button) offers to persist it as a real Group actor.
- **Export as a macro** — save the current actor/group, AC, crit, save DC, force-crit, and all use counts into a script macro that reopens the dialog pre-configured. Great for recurring encounters.
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
2. Open an actor sheet and click the **Damage Analyst** header button.
3. Set the target AC, crit threshold, and save DC. Tick **Force crits** to model a guaranteed crit.
4. Optionally add more actors under **Temp group** to analyze several at once — switch between members and the combined **All** tab.
5. Use the `−`/`+` steppers to set how often each weapon, spell, or cantrip is used per round.
6. Read the per-item and total DPR / average damage figures.
7. Click **Export Macro** to save the whole setup as a reusable script macro; running it reopens the dialog with everything pre-filled.

### The exported macro

`Export Macro` creates a script macro in your Macro Directory. It calls the module's public API:

```js
game.modules.get("dnd5e-damage-analyst").api.openWithState({
  actorId: "<actorId>",        // single actor or saved group (optional)
  tempGroupIds: ["<id>", ...],  // ad-hoc temporary group (optional)
  targetAC: 15,
  critMin: 20,
  saveDCOverride: null,
  forceCrit: false,
  entryCounts: { "<actorId>:<entryId>": 2 },
  activeMemberId: "all"
});
```

You can edit the generated macro by hand to tweak counts or swap actors.

## License

See [LICENSE](LICENSE) if present, otherwise all rights reserved by the author.
