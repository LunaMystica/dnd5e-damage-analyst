# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Module Does

A FoundryVTT module (D&D 5e system only) that opens an analysis dialog showing damage-per-round (DPR) and average damage/healing for any actor. Users set a target AC, crit threshold, and save DC, then assign use counts to weapons/spells/cantrips to see totals.

## Deployment

No build step. This is plain vanilla ES modules deployed directly to FoundryVTT's `Data/modules/` directory. To test: reload FoundryVTT in the browser after saving a file. There is no package.json, bundler, transpiler, linter, or test runner.

## Architecture

```
Hooks (main.js)
    └── AnalystDialog (apps/AnalystDialog.js)   — UI state + orchestration
            ├── extractor.js                     — reads dnd5e Actor/Item data → plain objects
            └── engine.js                        — pure math, zero Foundry API calls
                        ↓
              Handlebars templates (templates/*.hbs)
```

**State lives in `AnalystDialog`:** `actor`, `targetAC`, `critMin`, `saveDCOverride`, `entryCounts` (Map of item-id → use count). On each render, `_prepareContext()` calls `extractItems(actor)` then passes each item through the appropriate engine function.

**`extractor.js`** handles all dnd5e system API reads. It supports two API generations simultaneously:
- dnd5e v4+: `item.system.activities` (Map or plain object, iterated via `.values()`)
- dnd5e v3 legacy: `item.system.actionType`, `item.system.damage.parts`, `item.system.save.*`

Spell DC resolution priority: activity save DC → `actor.system.attributes.spell.dc` → `actor.system.attributes.spelldc` → item flat DC.

**`engine.js`** is pure math — no Foundry globals. Four calculation paths:
- `calcAttackItem()` — hit chance × avg damage + crit chance × crit bonus
- `calcSaveItem()` — fail chance × full damage + pass chance × half/0 damage
- `calcHealingItem()` — simple average with min/max range
- `calcDamageItem()` — direct average damage, no attack or save gate

## FoundryVTT Patterns Used

- `HandlebarsApplicationMixin(ApplicationV2)` — Foundry v12+ API. `static PARTS` maps part IDs to template paths; `_preparePartContext()` is called per-part; `_attachPartListeners()` handles per-part event delegation.
- `static TABS` drives tab navigation via Foundry's generic tab template.
- `static actions: { recompute }` maps `data-action` HTML attributes to static methods.
- Singleton window: `Object.values(ui.windows).find(w => w instanceof AnalystDialog)`.
- Hook: `renderActorDirectory` injects the sidebar button; `targetToken` auto-refreshes the dialog.

## CSS

All module classes are prefixed `da-` to avoid collisions with Foundry/dnd5e styles.

## Formula Resolution Pipeline

`getScaledPartFormula()` → `resolveFormula()` → `replaceFormulaData()` (substitutes `@mod`, `@prof`, etc. via `CONFIG.Dice.BasicRoll.replaceFormulaData`) → `evaluateFormulaFragments()` (collapses arithmetic in parentheses via sandboxed `Function()`, preserving dice terms like `2d6`) → `formatDisplayFormula()`
