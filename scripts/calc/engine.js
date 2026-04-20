/**
 * calc/engine.js
 * Pure math — no Foundry API calls. Fully testable in isolation.
 *
 * Key formulae:
 *   hitChance  = clamp( (21 - (AC - attackBonus)) / 20, 0.05, 0.95 )
 *   critChance = (21 - critMin) / 20
 *   avgDie(d)  = (d + 1) / 2
 *   avgDmgHit  = Σ qty×avgDie(faces) + flat
 *   avgDmgCrit = avgDmgHit + Σ qty×avgDie(faces)   [extra dice only]
 *   DPR        = hitChance×avgDmgHit + critChance×avgDmgCrit
 *
 * Save spells:
 *   No hit roll — full damage on fail, half on save (or 0 if "no damage on save").
 *   DPR = failChance×avgDmg + saveChance×(avgDmg×saveMultiplier)
 */

// ---------------------------------------------------------------------------
// Dice helpers
// ---------------------------------------------------------------------------

/** Average result of a single dN. */
function avgDie(faces) {
  return (faces + 1) / 2;
}

/**
 * Parse a Roll formula string into a list of { qty, faces, flat } parts.
 * Handles e.g. "2d6 + 1d4 + 5" or "1d8+3".
 * Returns { diceParts: [{qty, faces}], flat: number }
 */
export function parseFormula(formula) {
  if (!formula || typeof formula !== "string") return { diceParts: [], flat: 0 };

  const clean = formula.replace(/\s+/g, "").toLowerCase();
  const diceParts = [];
  let flat = 0;

  // Tokenise on + and - keeping the sign
  const tokens = clean.match(/[+\-]?[^+\-]+/g) ?? [];

  for (const token of tokens) {
    const dieMatch = token.match(/^([+\-]?\d*)d(\d+)$/);
    if (dieMatch) {
      const qty   = parseInt(dieMatch[1] === "" || dieMatch[1] === "+" ? "1"
                           : dieMatch[1] === "-" ? "-1"
                           : dieMatch[1], 10);
      const faces = parseInt(dieMatch[2], 10);
      if (faces > 0) diceParts.push({ qty, faces });
    } else {
      // Pure number
      const n = parseFloat(token);
      if (!isNaN(n)) flat += n;
    }
  }

  return { diceParts, flat };
}

/**
 * Combine multiple formula strings into a single normalized additive formula.
 * Each entry may optionally be multiplied by a count, such as number of attacks.
 * @param {Array<{ formula: string, count?: number }>} entries
 * @returns {string}
 */
export function summarizeFormulae(entries = []) {
  const diceByFaces = new Map();
  let flat = 0;

  for (const entry of entries) {
    const formula = entry?.formula ?? "";
    const count = Math.max(0, Number.isFinite(entry?.count) ? entry.count : 1);
    if (!formula || count === 0) continue;

    const parsed = parseFormula(formula);
    for (const { qty, faces } of parsed.diceParts) {
      diceByFaces.set(faces, (diceByFaces.get(faces) ?? 0) + (qty * count));
    }
    flat += parsed.flat * count;
  }

  return formatFormulaParts({
    diceParts: Array.from(diceByFaces.entries()).map(([faces, qty]) => ({
      qty,
      faces,
    })),
    flat,
  });
}

/**
 * Average damage for a parsed formula.
 */
export function avgFromParts({ diceParts, flat }) {
  return diceParts.reduce((sum, { qty, faces }) => sum + qty * avgDie(faces), flat);
}

/**
 * Min damage on a hit (all dice roll 1).
 */
export function minFromParts({ diceParts, flat }) {
  return diceParts.reduce((sum, { qty, faces }) => sum + Math.abs(qty), flat);
}

/**
 * Max damage on a hit (all dice roll max).
 */
export function maxFromParts({ diceParts, flat }) {
  return diceParts.reduce((sum, { qty, faces }) => sum + Math.abs(qty) * faces, flat);
}

// ---------------------------------------------------------------------------
// Attack-roll items (weapons + attack spells)
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}   opts.formula     — damage roll formula string
 * @param {number}   opts.attackBonus — total attack bonus (prof + ability)
 * @param {number}   opts.targetAC    — target's armour class
 * @param {number}   opts.critMin     — minimum d20 face for a crit (default 20)
 * @param {number}   [opts.attackCount=0] — number of times this attack is made per round
 * @returns {AttackResult}
 */
export function calcAttackItem({
  formula,
  attackBonus,
  targetAC,
  critMin = 20,
  attackCount = 0,
}) {
  const parsed = parseFormula(formula);
  const attacks = Math.max(0, Number.isFinite(attackCount) ? attackCount : 0);

  const hitChance  = Math.min(0.95, Math.max(0.05, (21 - (targetAC - attackBonus)) / 20));
  const critChance = (21 - critMin) / 20;
  const missChance = 1 - hitChance - critChance;   // guaranteed hits always hit

  const avgHit  = avgFromParts(parsed);
  // On a crit: roll damage dice twice, keep flat once
  const avgCrit = avgHit + parsed.diceParts.reduce(
    (sum, { qty, faces }) => sum + qty * avgDie(faces), 0
  );

  const singleAttackDpr = hitChance * avgHit + critChance * avgCrit;
  const dpr = singleAttackDpr * attacks;

  return {
    type:        "attack",
    attacks,
    avgHit:      round2(avgHit),
    avgCrit:     round2(avgCrit),
    singleAttackDpr: round2(singleAttackDpr),
    dpr:         round2(dpr),
    hitChance:   round2(hitChance * 100),   // percent
    critChance:  round2(critChance * 100),
    minDmg:      minFromParts(parsed),
    maxDmg:      maxFromParts(parsed),
    formula,
  };
}

// ---------------------------------------------------------------------------
// Save spells
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}   opts.formula          — damage roll formula
 * @param {number}   opts.saveDC           — caster's spell save DC
 * @param {string}   opts.saveAbility      — "dex" | "con" | "wis" etc.
 * @param {boolean}  opts.halfOnSave       — true = half damage on success, false = 0
 * @param {number}   [opts.targetSaveBonus=0] — target's save bonus (unknown = 0)
 * @returns {SaveResult}
 */
export function calcSaveItem({
  formula,
  saveDC,
  saveAbility,
  halfOnSave = true,
  targetSaveBonus = 0,
}) {
  const parsed = parseFormula(formula);
  const resolvedSaveDC = Number.isFinite(saveDC) ? saveDC : null;

  // Probability target FAILS the save (i.e. we deal full damage)
  // failChance = clamp( (saveDC - targetSaveBonus - 1) / 20, 0.05, 0.95 )
  const failChance = (resolvedSaveDC === null)
    ? 0
    : Math.min(0.95, Math.max(0.05,
      (resolvedSaveDC - targetSaveBonus - 1) / 20
    ));
  const saveChance = (resolvedSaveDC === null) ? 0 : (1 - failChance);

  const avgFull = avgFromParts(parsed);
  const avgSave = halfOnSave ? avgFull / 2 : 0;
  const dpr     = (resolvedSaveDC === null)
    ? 0
    : (failChance * avgFull + saveChance * avgSave);

  return {
    type:        "save",
    saveAbility: saveAbility?.toUpperCase() ?? "—",
    saveDC:      resolvedSaveDC ?? "—",
    halfOnSave,
    avgFull:     round2(avgFull),
    avgSave:     round2(avgSave),
    dpr:         round2(dpr),
    failChance:  round2(failChance * 100),
    minDmg:      minFromParts(parsed),
    maxDmg:      maxFromParts(parsed),
    formula,
  };
}

// ---------------------------------------------------------------------------
// Healing
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.formula  healing roll formula
 * @returns {object}
 */
export function calcHealingItem({ formula }) {
  const parsed = parseFormula(formula);
  const avg = avgFromParts(parsed);

  return {
    type:    "healing",
    avgHeal: round2(avg),
    minHeal: minFromParts(parsed),
    maxHeal: maxFromParts(parsed),
    formula,
  };
}

// ---------------------------------------------------------------------------
// Direct damage activities
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.formula
 * @param {number} [opts.useCount=0]
 * @returns {object}
 */
export function calcDamageItem({ formula, useCount = 0 }) {
  const parsed = parseFormula(formula);
  const uses = Math.max(0, Number.isFinite(useCount) ? useCount : 0);
  const avg = avgFromParts(parsed);

  return {
    type: "damage",
    uses,
    avgDamage: round2(avg),
    singleUseDpr: round2(avg),
    dpr: round2(avg * uses),
    minDmg: minFromParts(parsed),
    maxDmg: maxFromParts(parsed),
    formula,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatFormulaParts({ diceParts = [], flat = 0 }) {
  const diceTerms = [...diceParts]
    .filter(({ qty, faces }) => qty && faces > 0)
    .sort((a, b) => b.faces - a.faces)
    .map(({ qty, faces }) => `${qty}d${faces}`);

  const flatTerm = flat ? [String(round2(flat))] : [];
  const terms = [...diceTerms, ...flatTerm];
  if (!terms.length) return "—";

  return terms.reduce((formula, term, index) => {
    if (index === 0) return term;
    return term.startsWith("-")
      ? `${formula} - ${term.slice(1)}`
      : `${formula} + ${term}`;
  }, "");
}
