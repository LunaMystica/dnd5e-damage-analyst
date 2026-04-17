// Module-wide constants
export const MODULE_ID = "dnd5e-damage-analyst";
export const MODULE_TITLE = "Damage Analyst";

// Sidebar button ID
export const SIDEBAR_BUTTON_ID = "damage-analyst-open";

// Item type groupings
export const WEAPON_TYPES = new Set(["weapon"]);
export const SPELL_TYPES  = new Set(["spell"]);

// dnd5e spell activation types that deal damage via an attack roll
export const ATTACK_ACTIVATIONS = new Set(["action", "bonus", "legendary", "lair"]);

// Default settings
export const DEFAULTS = {
  includedSpells:    true,
  includeSaveSpells: true,
  includeHealing:    true,
  critMin:           20,   // minimum die face that triggers a crit
};
