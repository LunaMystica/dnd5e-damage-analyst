/**
 * apps/AnalystDialog.js
 * Main damage analysis window.
 * Uses Foundry v12 ApplicationV2 + HandlebarsApplicationMixin.
 */

import { MODULE_ID, DEFAULTS } from "../constants.js";
import { extractItems, getTargetAC } from "../calc/extractor.js";
import {
  calcAttackItem,
  calcHealingItem,
  calcSaveItem,
  summarizeFormulae,
} from "../calc/engine.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const CATEGORY_ORDER = ["weapons", "cantrips", "spells", "healing"];
const CATEGORY_TABS = {
  weapons: {
    icon: "fa-solid fa-sword",
    label: "Weapons",
  },
  cantrips: {
    icon: "fa-solid fa-sparkles",
    label: "Cantrips",
  },
  spells: {
    icon: "fa-solid fa-book-sparkles",
    label: "Spells",
  },
  healing: {
    icon: "fa-solid fa-heart",
    label: "Healing",
  },
};

export class AnalystDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static #log(message, data) {
    if (data === undefined) {
      console.log("[Damage Analyst][Dialog]", message);
      return;
    }

    console.log("[Damage Analyst][Dialog]", message, data);
  }

  static #warn(message, data) {
    if (data === undefined) {
      console.warn("[Damage Analyst][Dialog]", message);
      return;
    }

    console.warn("[Damage Analyst][Dialog]", message, data);
  }

  // -------------------------------------------------------------------------
  // Static config
  // -------------------------------------------------------------------------

  static DEFAULT_OPTIONS = {
    id: "damage-analyst-dialog",
    tag: "form",
    classes: ["standard-form", "damage-analyst-dialog", "da-dialog"],
    window: {
      title: "Damage Analyst",
      resizable: true,
      contentClasses: ["standard-form", "damage-analyst-dialog"],
    },
    position: {
      width: 1080,
      height: 920,
    },
    actions: {
      recompute: AnalystDialog.#onRecompute,
    },
  };

  static PARTS = {
    controls: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-controls.hbs`,
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs",
    },
    weapons: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-weapons.hbs`,
      scrollable: [""],
    },
    cantrips: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-cantrips.hbs`,
      scrollable: [""],
    },
    spells: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-spells.hbs`,
      scrollable: [""],
    },
    healing: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-healing.hbs`,
      scrollable: [""],
    },
  };

  static TABS = {
    primary: {
      tabs: CATEGORY_ORDER.map((id) => ({ id, ...CATEGORY_TABS[id] })),
      initial: "weapons",
    },
  };

  // -------------------------------------------------------------------------
  // Instance state
  // -------------------------------------------------------------------------

  /** @type {Actor5e|null} */
  #actor = null;

  /** @type {number} */
  #targetAC = 15;

  /** @type {number} */
  #critMin = DEFAULTS.critMin;

  /** @type {number|null} */
  #saveDCOverride = null;

  /** @type {boolean} */
  #includeSpells = DEFAULTS.includedSpells;

  /** @type {boolean} */
  #includeSaveSpells = DEFAULTS.includeSaveSpells;

  /** @type {boolean} */
  #includeHealing = DEFAULTS.includeHealing;

  /** Extra attack count per actor/item pair for weapon rows */
  #weaponAttackCounts = {};

  /** Computed results — set by #compute() */
  #results = { weapons: [], cantrips: [], spells: [], healing: [] };

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  constructor(options = {}) {
    super(options);
    AnalystDialog.#log("Constructor invoked", { options });
    this.#actor = options.actor ?? AnalystDialog.#resolveDefaultActor();
    this.#targetAC =
      options.targetAC ?? getTargetAC(game.user.targets.first() ?? null, 15);
    AnalystDialog.#log("Constructor state initialized", {
      actor: this.#actor?.name ?? null,
      actorId: this.#actor?.id ?? null,
      targetAC: this.#targetAC,
      saveDCOverride: this.#saveDCOverride,
    });
  }

  /** Re-open singleton rather than stacking windows */
  static open() {
    AnalystDialog.#log("Open requested");
    const actor = AnalystDialog.#resolveDefaultActor();

    const existing = Object.values(ui.windows).find(
      (w) => w instanceof AnalystDialog,
    );
    if (existing) {
      AnalystDialog.#log("Reusing existing window");
      existing.bringToTop();
      if (actor?.type === "npc") existing.#actor = actor;
      existing.#targetAC = getTargetAC(
        game.user.targets.first() ?? null,
        existing.#targetAC,
      );
      existing.render();
      return existing;
    }

    const targetAC = getTargetAC(game.user.targets.first() ?? null, 15);
    AnalystDialog.#log("Creating new dialog", {
      actor: actor?.name ?? null,
      actorId: actor?.id ?? null,
      targetAC,
    });
    return new AnalystDialog({ actor, targetAC }).render(true);
  }

  // -------------------------------------------------------------------------
  // Data preparation
  // -------------------------------------------------------------------------

  async _prepareContext(options) {
    AnalystDialog.#log("_prepareContext called", {
      actor: this.#actor?.name ?? null,
      actorId: this.#actor?.id ?? null,
      targetAC: this.#targetAC,
      critMin: this.#critMin,
      saveDCOverride: this.#saveDCOverride,
      includeSpells: this.#includeSpells,
      includeSaveSpells: this.#includeSaveSpells,
      includeHealing: this.#includeHealing,
    });
    this.#compute();
    this.tabGroups.primary ??= this.#getPreferredTab();

    const actors = AnalystDialog.#getSelectableActors(this.#actor);
    const context = await super._prepareContext(options);
    AnalystDialog.#log("_prepareContext actor list prepared", {
      actorCount: actors.length,
      resultCounts: {
        weapons: this.#results.weapons.length,
        cantrips: this.#results.cantrips.length,
        spells: this.#results.spells.length,
        healing: this.#results.healing.length,
      },
    });

    return {
      ...context,
      actors,
      selectedActorId: this.#actor?.id ?? "",
      targetAC: this.#targetAC,
      critMin: this.#critMin,
      saveDCOverride: this.#saveDCOverride,
      includeSpells: this.#includeSpells,
      includeSaveSpells: this.#includeSaveSpells,
      includeHealing: this.#includeHealing,
      results: this.#results,
      tabs: this._prepareTabs("primary"),
      hasWeapons: this.#results.weapons.length > 0,
      hasCantrips: this.#results.cantrips.length > 0,
      hasSpells: this.#results.spells.length > 0,
      hasHealing: this.#results.healing.length > 0,
    };
  }

  async _preparePartContext(partId, context, options) {
    const baseContext =
      (await super._preparePartContext?.(partId, context, options)) ?? context;

    if (!CATEGORY_ORDER.includes(partId)) return baseContext;

    const weaponSummary =
      partId === "weapons"
        ? this.#getWeaponSummary(this.#results.weapons)
        : null;

    return {
      ...baseContext,
      category: CATEGORY_TABS[partId],
      entries: this.#results[partId],
      hasEntries: this.#results[partId].length > 0,
      emptyMessage: this.#getEmptyMessage(partId),
      weaponSummary,
      tab: baseContext.tabs[partId],
    };
  }

  // -------------------------------------------------------------------------
  // Core computation
  // -------------------------------------------------------------------------

  #compute() {
    AnalystDialog.#log("#compute called", {
      actor: this.#actor?.name ?? null,
      actorId: this.#actor?.id ?? null,
    });

    if (!this.#actor) {
      this.#results = { weapons: [], cantrips: [], spells: [], healing: [] };
      AnalystDialog.#warn("#compute aborted: no actor selected");
      return;
    }

    const { weapons, cantrips, spells, healing } = extractItems(this.#actor, {
      includeSpells: this.#includeSpells,
      includeSaveSpells: this.#includeSaveSpells,
      includeHealing: this.#includeHealing,
    });

    this.#results = {
      weapons: weapons.map((d) =>
        this.#runCalc(d, {
          attackCount: this.#getWeaponAttackCount(d.id),
        }),
      ),
      cantrips: cantrips.map((d) => this.#runCalc(d)),
      spells: spells.map((d) => this.#runCalc(d)),
      healing: healing.map((d) => this.#runCalc(d)),
    };

    AnalystDialog.#log("#compute completed", {
      actor: this.#actor.name,
      extracted: {
        weapons: weapons.length,
        cantrips: cantrips.length,
        spells: spells.length,
        healing: healing.length,
      },
      computed: {
        weapons: this.#results.weapons.length,
        cantrips: this.#results.cantrips.length,
        spells: this.#results.spells.length,
        healing: this.#results.healing.length,
      },
    });
  }

  #runCalc(itemData, { attackCount = 0 } = {}) {
    const base = {
      id: itemData.id,
      name: itemData.name,
      img: itemData.img,
      activation: itemData.activation,
      damageType: itemData.damageType,
      formula: itemData.formula,
    };

    if (itemData.kind === "healing") {
      return {
        ...base,
        healingType: itemData.healingType,
        ...calcHealingItem({
          formula: itemData.formula,
        }),
      };
    }

    if (itemData.kind === "attack") {
      return {
        ...base,
        attacks: attackCount,
        ...calcAttackItem({
          formula: itemData.formula,
          attackBonus: itemData.attackBonus,
          targetAC: this.#targetAC,
          critMin: this.#critMin,
          attackCount,
        }),
      };
    }

    // save spell
    return {
      ...base,
      ...calcSaveItem({
        formula: itemData.formula,
        saveDC: this.#saveDCOverride ?? itemData.saveDC,
        saveAbility: itemData.saveAbility,
        halfOnSave: itemData.halfOnSave,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  /** Delegated from data-action="recompute" (any control change) */
  static #onRecompute(_event, _target) {
    this.render();
  }

  /**
   * Capture live form field values before re-render.
   * Called by ApplicationV2 before _prepareContext.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    AnalystDialog.#log("_onRender called", {
      hasElement: Boolean(this.element),
      elementType: this.element?.constructor?.name ?? null,
    });
    this.#autoSizeWidth();
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners?.(partId, htmlElement, options);

    if (!htmlElement) {
      AnalystDialog.#warn("_attachPartListeners called without element");
      return;
    }

    if (partId === "weapons") {
      AnalystDialog.#log("_attachPartListeners binding weapon listeners", {
        elementType: htmlElement.constructor?.name ?? null,
      });

      htmlElement.querySelectorAll(".da-weapon-attacks").forEach((input) => {
        input.addEventListener("change", (e) => {
          const itemId = e.currentTarget?.dataset?.itemId;
          if (!itemId) return;

          const parsed = parseInt(e.currentTarget.value, 10);
          const attackCount = Number.isFinite(parsed)
            ? Math.max(0, parsed)
            : 0;

          this.#setWeaponAttackCount(itemId, attackCount);
          this.render();
        });
      });

      return;
    }

    if (partId !== "controls") return;

    AnalystDialog.#log("_attachPartListeners binding control listeners", {
      elementType: htmlElement.constructor?.name ?? null,
    });

    // Actor selector
    htmlElement
      .querySelector("#da-actor-select")
      ?.addEventListener("change", (e) => {
        this.#actor = game.actors.get(e.target.value) ?? null;
        this.render();
      });

    // AC input
    htmlElement
      .querySelector("#da-target-ac")
      ?.addEventListener("change", (e) => {
        this.#targetAC = parseInt(e.target.value, 10) || 10;
        this.render();
      });

    // Crit min input
    htmlElement
      .querySelector("#da-crit-min")
      ?.addEventListener("change", (e) => {
        const v = parseInt(e.target.value, 10);
        this.#critMin = Math.min(20, Math.max(1, v || 20));
        this.render();
      });

    htmlElement
      .querySelector("#da-save-dc-override")
      ?.addEventListener("change", (e) => {
        const raw = e.target.value?.trim?.() ?? "";
        if (!raw) {
          this.#saveDCOverride = null;
        } else {
          const parsed = parseInt(raw, 10);
          this.#saveDCOverride = Number.isFinite(parsed)
            ? Math.max(1, parsed)
            : null;
        }
        this.render();
      });

    // Include spells toggle
    htmlElement
      .querySelector("#da-include-spells")
      ?.addEventListener("change", (e) => {
        this.#includeSpells = e.target.checked;
        this.render();
      });

    // Include save spells toggle
    htmlElement
      .querySelector("#da-include-save-spells")
      ?.addEventListener("change", (e) => {
        this.#includeSaveSpells = e.target.checked;
        this.render();
      });

    htmlElement
      .querySelector("#da-include-healing")
      ?.addEventListener("change", (e) => {
        this.#includeHealing = e.target.checked;
        this.render();
      });
  }

  #autoSizeWidth() {
    const content = this.element?.querySelector(".window-content");
    if (!content || typeof this.setPosition !== "function") return;

    requestAnimationFrame(() => {
      const maxHeight = Math.min(window.innerHeight - 48, 900);
      const currentWidth =
        this.position?.width ?? this.options?.position?.width ?? 560;
      const currentHeight =
        this.position?.height ?? this.options?.position?.height ?? 720;
      const width = Math.max(
        1080,
        Math.min(currentWidth, window.innerWidth - 48),
      );
      const height = Math.max(420, Math.min(currentHeight, maxHeight));
      this.setPosition({ width, height });
    });
  }

  #getPreferredTab() {
    return (
      CATEGORY_ORDER.find((category) => this.#results[category].length > 0) ??
      CATEGORY_ORDER[0]
    );
  }

  #getEmptyMessage(partId) {
    if (!this.#actor) return "Select an actor above to begin.";

    if (partId === "healing" && !this.#includeHealing) {
      return "Healing is hidden by the current filters.";
    }

    if (
      ["cantrips", "spells"].includes(partId) &&
      !this.#includeSpells &&
      !this.#includeSaveSpells
    ) {
      return "Spell entries are hidden by the current filters.";
    }

    switch (partId) {
      case "weapons":
        return "No weapon entries were found for this actor.";
      case "cantrips":
        return "No cantrip entries matched the current filters.";
      case "spells":
        return "No spell entries matched the current filters.";
      case "healing":
        return "No healing entries matched the current filters.";
      default:
        return "No entries found.";
    }
  }

  #getWeaponAttackKey(itemId) {
    return `${this.#actor?.id ?? "none"}:${itemId}`;
  }

  #getWeaponAttackCount(itemId) {
    return this.#weaponAttackCounts[this.#getWeaponAttackKey(itemId)] ?? 0;
  }

  #setWeaponAttackCount(itemId, attackCount) {
    this.#weaponAttackCounts[this.#getWeaponAttackKey(itemId)] = attackCount;
  }

  #getWeaponSummary(entries) {
    const activeEntries = entries.filter((entry) => (entry.attacks ?? 0) > 0);

    const totals = activeEntries.reduce(
      (summary, entry) => {
        summary.weaponCount += 1;
        summary.attackCount += entry.attacks ?? 0;
        summary.dpr += entry.dpr ?? 0;
        summary.avgDamage += (entry.avgHit ?? 0) * (entry.attacks ?? 0);
        return summary;
      },
      { weaponCount: 0, attackCount: 0, dpr: 0, avgDamage: 0 },
    );

    return {
      ...totals,
      combinedFormula: summarizeFormulae(
        activeEntries.map((entry) => ({
          formula: entry.formula,
          count: entry.attacks ?? 0,
        })),
      ),
      hasActiveWeapons: activeEntries.length > 0,
      dpr: Math.round(totals.dpr * 100) / 100,
      avgDamage: Math.round(totals.avgDamage * 100) / 100,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  static #resolveDefaultActor() {
    return AnalystDialog.#getHoveredNpcActor() ?? null;
  }

  static #getHoveredNpcActor() {
    const hover = canvas.tokens?.hover;
    const hovered = hover?.actor
      ? hover
      : canvas.tokens?.placeables?.find((t) => t.hover);
    const actor = hovered?.actor ?? null;
    return actor?.type === "npc" ? actor : null;
  }

  static #getSelectableActors(selectedActor = null) {
    const actors = game.actors.filter((a) => a.type === "character");
    const extras = [AnalystDialog.#getHoveredNpcActor(), selectedActor].filter(
      (a) => a?.type === "npc",
    );

    for (const extra of extras) {
      if (extra && !actors.some((a) => a.id === extra.id))
        actors.unshift(extra);
    }

    return actors;
  }
}
