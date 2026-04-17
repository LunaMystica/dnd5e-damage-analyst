/**
 * calc/extractor.js
 * Reads dnd5e system data from Foundry actor/item documents.
 * Returns plain objects that the engine can consume — no math here.
 *
 * Legacy dnd5e item paths used:
 *   actor.system.abilities[abi].mod
 *   actor.system.attributes.prof
 *   actor.system.attributes.spelldc
 *   item.system.actionType          "mwak"|"rwak"|"msak"|"rsak"|"save"|"other"
 *   item.system.attack.bonus        extra attack bonus string
 *   item.system.ability             ability used for attack/damage
 *   item.system.damage.parts        [[formula, damageType], ...]
 *   item.system.save.ability        save ability for save spells
 *   item.system.save.scaling        "spell"|"flat"
 *   item.system.save.dc             override DC when scaling="flat"
 *   item.system.activation.type     "action"|"bonus"|"reaction"|...
 *   item.type                       "weapon"|"spell"
 *   item.system.level               spell level (0 = cantrip)
 *   item.flags.dnd5e.critRange      optional expanded crit range flag
 *
 * Modern dnd5e v4+ activity paths used:
 *   item.system.activities[*].actionType
 *   item.system.activities[*].attack
 *   item.system.activities[*].damage.parts
 *   item.system.activities[*].damage.onSave
 *   item.system.activities[*].save
 *   actor.system.attributes.spell.attack
 *   actor.system.attributes.spell.dc
 */

import { WEAPON_TYPES, SPELL_TYPES } from "../constants.js";

// Action types that use an attack roll
const ATTACK_ACTION_TYPES = new Set(["mwak", "rwak", "msak", "rsak"]);
// Action types that use a saving throw
const SAVE_ACTION_TYPES   = new Set(["save"]);

function debugLog(message, data) {
  if (data === undefined) {
    console.debug("[Damage Analyst]", message);
    return;
  }

  console.debug("[Damage Analyst]", message, data);
}

function getActivities(item) {
  const activities = item.system?.activities;
  if (!activities) return [];
  if (typeof activities.values === "function") return Array.from(activities.values());
  return Object.values(activities);
}

function summarizeActivities(item) {
  return getActivities(item).map(activity => ({
    id: activity.id ?? activity._id ?? null,
    type: activity.type ?? null,
    activationType: activity.activation?.type ?? null,
    actionType: activity.actionType ?? null,
    attack: activity.attack ?? null,
    save: activity.save ?? null,
    damage: activity.damage ?? null,
    healing: activity.healing ?? null,
  }));
}

function getPrimaryAttackActivity(item) {
  return getActivities(item).find(activity => ATTACK_ACTION_TYPES.has(activity.actionType));
}

function getPrimarySaveActivity(item) {
  return getActivities(item).find(activity => SAVE_ACTION_TYPES.has(activity.type ?? activity.actionType))
    ?? getActivities(item).find(activity => SAVE_ACTION_TYPES.has(activity.actionType));
}

function getPrimaryHealActivity(item) {
  return getActivities(item).find(activity => (activity.type === "heal") || activity.healing?.formula);
}

function getActivationType(item, activity = null) {
  return activity?.activation?.type ?? item.system?.activation?.type ?? null;
}

function formatActivationType(type) {
  if (!type) return "—";
  const labels = {
    action: "Action",
    bonus: "Bonus Action",
    reaction: "Reaction",
    minute: "Minute",
    hour: "Hour",
    day: "Day",
    special: "Special",
    legendary: "Legendary",
    lair: "Lair",
  };
  return labels[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function getLegacyActionType(item) {
  return item.system?.actionType ?? item.system?.activation?.type;
}

function getEffectiveAttackActionType(item) {
  return getPrimaryAttackActivity(item)?.actionType ?? getLegacyActionType(item);
}

function getEffectiveSaveActionType(item) {
  const activity = getPrimarySaveActivity(item);
  return activity?.type ?? activity?.actionType ?? getLegacyActionType(item);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract all relevant items from an actor, grouped by category.
 * @param {Actor5e} actor
 * @param {object}  opts
 * @param {boolean} opts.includeSpells       include attack spells / cantrips
 * @param {boolean} opts.includeSaveSpells   include save-based spells
 * @param {boolean} opts.includeHealing      include healing spells
 * @returns {{ weapons: ItemData[], cantrips: ItemData[], spells: ItemData[], healing: ItemData[] }}
 */
export function extractItems(actor, {
  includeSpells = true,
  includeSaveSpells = true,
  includeHealing = true,
} = {}) {
  const weapons  = [];
  const cantrips = [];
  const spells   = [];
  const healing  = [];

  debugLog("Starting item extraction", {
    actor: actor?.name ?? "(none)",
    actorId: actor?.id ?? null,
    itemCount: actor?.items?.size ?? actor?.items?.length ?? 0,
    includeSpells,
    includeSaveSpells,
    includeHealing,
  });

  for (const item of actor.items) {
    const sys = item.system;
    const actionType = getLegacyActionType(item);
    const attackActionType = getEffectiveAttackActionType(item);
    const saveActionType = getEffectiveSaveActionType(item);
    const healActivity = getPrimaryHealActivity(item);
    const baseInfo = {
      id: item.id,
      name: item.name,
      type: item.type,
      actionType,
      attackActionType,
      saveActionType,
      hasHealActivity: Boolean(healActivity),
      level: sys.level ?? 0,
      activationType: sys.activation?.type ?? null,
      damageParts: sys.damage?.parts ?? [],
      ability: sys.ability ?? null,
      proficient: item.system.proficient ?? item.system.prof?.hasProficiency ?? null,
      attackBonus: sys.attack?.bonus ?? sys.attackBonus ?? "",
      save: sys.save ?? null,
      activities: summarizeActivities(item),
    };

    debugLog("Inspecting item", baseInfo);

    // ---- Weapons ----
    if (WEAPON_TYPES.has(item.type)) {
      if (!ATTACK_ACTION_TYPES.has(attackActionType)) {
        debugLog("Skipped weapon: no supported attack activity/action type", {
          ...baseInfo,
          expectedActionTypes: Array.from(ATTACK_ACTION_TYPES),
        });
        continue;
      }

      const data = extractAttackItem(actor, item, getPrimaryAttackActivity(item));
      if (data) {
        weapons.push(data);
        debugLog("Accepted weapon attack item", {
          ...baseInfo,
          formula: data.formula,
          attackBonus: data.attackBonus,
        });
      } else {
        debugLog("Rejected weapon attack item: no usable damage formula", baseInfo);
      }
      continue;
    }

    if (!SPELL_TYPES.has(item.type)) {
      debugLog("Skipped item: unsupported type", baseInfo);
      continue;
    }

    const level = sys.level ?? 0;

    // ---- Attack spells / cantrips ----
    if (includeSpells && ATTACK_ACTION_TYPES.has(attackActionType)) {
      const data = extractAttackItem(actor, item, getPrimaryAttackActivity(item));
      if (data) {
        (level === 0 ? cantrips : spells).push(data);
        debugLog("Accepted attack spell", {
          ...baseInfo,
          bucket: level === 0 ? "cantrips" : "spells",
          formula: data.formula,
          attackBonus: data.attackBonus,
        });
      } else {
        debugLog("Rejected attack spell: no usable damage formula", baseInfo);
      }
      continue;
    }

    // ---- Save spells ----
    if (includeSaveSpells && SAVE_ACTION_TYPES.has(saveActionType)) {
      const data = extractSaveItem(actor, item, getPrimarySaveActivity(item));
      if (data) {
        (level === 0 ? cantrips : spells).push(data);
        debugLog("Accepted save spell", {
          ...baseInfo,
          bucket: level === 0 ? "cantrips" : "spells",
          formula: data.formula,
          saveDC: data.saveDC,
          saveAbility: data.saveAbility,
          halfOnSave: data.halfOnSave,
        });
      } else {
        debugLog("Rejected save spell: no usable damage formula", baseInfo);
      }
      continue;
    }

    if (includeHealing && healActivity) {
      const data = extractHealItem(item, healActivity);
      if (data) {
        healing.push(data);
        debugLog("Accepted healing spell", {
          ...baseInfo,
          formula: data.formula,
          healingType: data.healingType,
        });
      } else {
        debugLog("Rejected healing spell: no usable healing formula", baseInfo);
      }
      continue;
    }

    debugLog("Skipped spell: filters/action type did not match", {
      ...baseInfo,
      attackActionTypes: Array.from(ATTACK_ACTION_TYPES),
      saveActionTypes: Array.from(SAVE_ACTION_TYPES),
      includeSpells,
      includeSaveSpells,
    });
  }

  debugLog("Finished item extraction", {
    actor: actor?.name ?? "(none)",
    weapons: weapons.length,
    cantrips: cantrips.length,
    spells: spells.length,
    healing: healing.length,
  });

  return { weapons, cantrips, spells, healing };
}

/**
 * Get a target's AC from a token or default to a fallback number.
 * @param {Token5e|null} token
 * @param {number} fallback
 * @returns {number}
 */
export function getTargetAC(token, fallback = 15) {
  return token?.actor?.system?.attributes?.ac?.value ?? fallback;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractAttackItem(actor, item, activity = null) {
  const formula = buildDamageFormula(actor, item, activity);
  if (!formula) {
    debugLog("Attack item missing damage formula", {
      id: item.id,
      name: item.name,
      damageParts: item.system?.damage?.parts ?? [],
      activity: activity ? summarizeActivity(activity) : null,
    });
    return null;
  }

  const attackBonus = resolveAttackBonus(actor, item, activity);

  return {
    kind:        "attack",
    id:          item.id,
    name:        item.name,
    img:         item.img,
    activation:  formatActivationType(getActivationType(item, activity)),
    damageType:  primaryDamageType(item, activity),
    formula,
    attackBonus,
    // critMin will be injected by the dialog from its settings
    _item:       item,   // kept for potential future use, not serialised
  };
}

function extractSaveItem(actor, item, activity = null) {
  const formula = buildDamageFormula(actor, item, activity);
  if (!formula) {
    debugLog("Save item missing damage formula", {
      id: item.id,
      name: item.name,
      damageParts: item.system?.damage?.parts ?? [],
      save: item.system?.save ?? null,
      activity: activity ? summarizeActivity(activity) : null,
    });
    return null;
  }

  const sys = item.system;
  const saveAbility = resolveSaveAbility(item, activity);
  const halfOnSave = resolveHalfOnSave(item, activity);

  // Prefer activity-derived or current actor spell DC; fall back to legacy item data
  const saveDC = resolveSaveDC(actor, item, activity) ?? sys.save?.dc ?? 8;

  return {
    kind:       "save",
    id:         item.id,
    name:       item.name,
    img:        item.img,
    activation: formatActivationType(getActivationType(item, activity)),
    damageType: primaryDamageType(item, activity),
    formula,
    saveAbility,
    halfOnSave,
    saveDC,
    _item:      item,
  };
}

function extractHealItem(item, activity = null) {
  const formula = buildHealingFormula(item.actor ?? null, item, activity);
  if (!formula) {
    debugLog("Healing item missing formula", {
      id: item.id,
      name: item.name,
      activity: activity ? summarizeActivity(activity) : null,
    });
    return null;
  }

  return {
    kind:        "healing",
    id:          item.id,
    name:        item.name,
    img:         item.img,
    activation:  formatActivationType(getActivationType(item, activity)),
    healingType: primaryHealingType(activity),
    formula,
    _item:       item,
  };
}

/**
 * Collapse all damage parts into a single additive formula string.
 */
function buildDamageFormula(actor, item, activity = null) {
  const activityFormulae = getActivityDamageFormulae(actor, item, activity);
  if (activityFormulae.length) return activityFormulae.join(" + ");

  const parts = item.system?.damage?.parts ?? [];
  const formulae = parts
    .map(([f]) => resolveFormula(actor, item, f?.trim()))
    .filter(Boolean);
  if (!formulae.length) {
    debugLog("No non-empty damage parts found", {
      id: item.id,
      name: item.name,
      rawDamageParts: parts,
      activity: activity ? summarizeActivity(activity) : null,
    });
    return null;
  }
  return formulae.join(" + ");
}

function buildHealingFormula(actor, item, activity = null) {
  const formula = resolveFormula(
    actor,
    item,
    activity?.healing?.formula?.trim?.() ?? buildActivityPartFormula(activity?.healing),
  );
  if (formula) return formula;

  debugLog("No healing formula found", {
    id: item.id,
    name: item.name,
    activity: activity ? summarizeActivity(activity) : null,
  });
  return null;
}

/**
 * Total attack bonus for an item on this actor.
 * = proficiency (if proficient) + ability mod + item bonus
 */
function resolveAttackBonus(actor, item, activity = null) {
  if (activity?.attack?.type?.classification === "spell") {
    const spellAttack = actor.system?.attributes?.spell?.attack;
    const attackBonus = Number.isFinite(spellAttack) ? spellAttack : 0;
    return attackBonus + parseNumericBonus(activity.attack?.bonus ?? "");
  }

  const sys        = item.system;
  const abilityKey = resolveAttackAbility(actor, item, activity);
  const abilityMod = actor.system.abilities?.[abilityKey]?.mod ?? 0;
  const prof       = isProficient(actor, item) ? (actor.system.attributes.prof ?? 0) : 0;

  const rawBonus = activity?.attack?.bonus ?? sys.attack?.bonus ?? sys.attackBonus ?? "";
  const itemBonus = parseNumericBonus(rawBonus);

  return abilityMod + prof + itemBonus;
}

function resolveAttackAbility(actor, item, activity = null) {
  const configured = activity?.attack?.ability ?? item.system?.ability;
  if (configured === "spellcasting") {
    return actor.system?.attributes?.spellcasting ?? inferAbility(item, activity);
  }
  if (configured && configured !== "none") return configured;
  return inferAbility(item, activity);
}

function resolveSaveAbility(item, activity = null) {
  if (activity?.ability) return String(activity.ability).toLowerCase();

  const configured = activity?.save?.ability;
  if (configured instanceof Set) return Array.from(configured)[0] ?? "con";
  if (Array.isArray(configured)) return configured[0] ?? "con";
  return item.system?.save?.ability ?? "con";
}

function resolveHalfOnSave(item, activity = null) {
  if (activity?.damage?.onSave) return activity.damage.onSave !== "none";
  return item.system?.save?.scaling !== "none";
}

function resolveSaveDC(actor, item, activity = null) {
  const activitySave = activity?.save?.dc?.value;
  if (Number.isFinite(activitySave)) return activitySave;

  const spellDC = actor.system?.attributes?.spell?.dc;
  if (Number.isFinite(spellDC)) return spellDC;

  const legacySpellDC = actor.system?.attributes?.spelldc;
  if (Number.isFinite(legacySpellDC)) return legacySpellDC;

  const flatDC = activity?.save?.dc?.formula ?? item.system?.save?.dc;
  const parsedDC = parseFloat(flatDC);
  return Number.isNaN(parsedDC) ? null : parsedDC;
}

function getActivityDamageFormulae(actor, item, activity = null) {
  if (!activity?.damage) return [];

  const formulae = [];
  if (activity.damage.includeBase && item.system?.damage?.base?.formula) {
    formulae.push(resolveFormula(actor, item, item.system.damage.base.formula.trim()));
  }

  for (const part of activity.damage.parts ?? []) {
    const formula = resolveFormula(
      actor,
      item,
      part.formula?.trim?.() ?? buildActivityPartFormula(part),
    );
    if (formula) formulae.push(formula);
  }

  return dedupeFormulae(formulae);
}

function buildActivityPartFormula(part) {
  if (!part) return "";
  if (part.custom?.enabled && part.custom?.formula) return part.custom.formula.trim();

  let formula = "";
  if (part.number && part.denomination) formula = `${part.number}d${part.denomination}`;
  if (part.bonus) formula = formula ? `${formula} + ${part.bonus}` : String(part.bonus);
  return formula.trim();
}

function parseNumericBonus(rawBonus) {
  if (!rawBonus) return 0;
  const parsed = parseFloat(rawBonus);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function dedupeFormulae(formulae) {
  const seen = new Set();
  const deduped = [];

  for (const formula of formulae.filter(Boolean)) {
    const normalized = normalizeFormula(formula);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(formula);
  }

  return deduped;
}

function normalizeFormula(formula) {
  return String(formula).replace(/\s+/g, "").toLowerCase();
}

function resolveFormula(actor, item, formula) {
  if (!formula) return "";

  const rollData = getRollData(actor, item);
  let resolved = String(formula).trim();

  resolved = replaceDataPaths(resolved, rollData);
  resolved = evaluateFormulaFragments(resolved);

  return resolved;
}

function getRollData(actor, item) {
  const actorData = actor?.getRollData?.() ?? {};
  const itemData = item?.getRollData?.() ?? {};
  const itemSystem = item?.system ? { item: item.system } : {};

  return foundry.utils.mergeObject(
    foundry.utils.mergeObject(actorData, itemData, { inplace: false }),
    itemSystem,
    { inplace: false },
  );
}

function replaceDataPaths(formula, rollData) {
  const flattened = foundry.utils.flattenObject(rollData);

  return formula.replace(/@([a-zA-Z0-9._-]+)/g, (match, path) => {
    const value = flattened[path];
    if (value === undefined || value === null || value === "") return "0";
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "1" : "0";

    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : match;
  });
}

function evaluateFormulaFragments(formula) {
  let resolved = String(formula);

  // Collapse arithmetic inside parentheses once variables have been substituted.
  resolved = resolved.replace(/\(([^()]+)\)/g, (match, inner) => {
    const evaluated = safeEvalArithmetic(inner);
    return evaluated === null ? match : String(evaluated);
  });

  // Evaluate remaining arithmetic-only terms while preserving dice terms like 2d6.
  return resolved.replace(
    /(^|[+\-])\s*([^+\-]+)/g,
    (match, sign, term) => {
      const trimmed = term.trim();
      if (!trimmed || /d\d+/i.test(trimmed)) return match;

      const evaluated = safeEvalArithmetic(trimmed);
      if (evaluated === null) return match;

      return `${sign ?? ""}${evaluated}`;
    },
  );
}

function safeEvalArithmetic(expression) {
  const sanitized = String(expression).replace(/\s+/g, "");
  if (!sanitized) return null;
  if (!/^[0-9+\-*/.]+$/.test(sanitized)) return null;

  try {
    const value = Function(`"use strict"; return (${sanitized});`)();
    return Number.isFinite(value) ? roundNumber(value) : null;
  } catch {
    return null;
  }
}

function roundNumber(n) {
  return Math.round(n * 1000) / 1000;
}

function isProficient(actor, item) {
  // dnd5e sets item.system.proficient or calculates via the actor
  return item.system.proficient
      ?? item.system.prof?.hasProficiency
      ?? false;
}

function inferAbility(item, activity = null) {
  const actionType = activity?.actionType ?? item.system.actionType;
  if (actionType === "rwak" || actionType === "rsak") return "dex";
  return "str";
}

function primaryDamageType(item, activity = null) {
  const activityPart = activity?.damage?.parts?.[0];
  const activityType = activityPart?.types instanceof Set
    ? Array.from(activityPart.types)[0]
    : Array.isArray(activityPart?.types)
      ? activityPart.types[0]
      : null;
  const baseTypes = item.system?.damage?.base?.types;
  const baseType = baseTypes instanceof Set
    ? Array.from(baseTypes)[0]
    : Array.isArray(baseTypes)
      ? baseTypes[0]
      : null;
  return activityType
    ?? baseType
    ?? item.system?.damage?.parts?.[0]?.[1]
    ?? "—";
}

function summarizeActivity(activity) {
  return {
    id: activity.id ?? activity._id ?? null,
    type: activity.type ?? null,
    actionType: activity.actionType ?? null,
    attack: activity.attack ?? null,
    save: activity.save ?? null,
    damage: activity.damage ?? null,
    healing: activity.healing ?? null,
  };
}

function primaryHealingType(activity = null) {
  const types = activity?.healing?.types;
  if (types instanceof Set) return Array.from(types)[0] ?? "healing";
  if (Array.isArray(types)) return types[0] ?? "healing";
  return "healing";
}
