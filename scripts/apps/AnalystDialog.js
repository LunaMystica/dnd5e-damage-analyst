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
const CATEGORY_SUMMARY_LABELS = {
  weapons: {
    entryLabel: "Weapons used",
    averageLabel: "Total Avg Damage",
    emptyMessage:
      "No weapon counts selected yet. Set one or more counts above 0 to include them.",
    showDpr: true,
  },
  cantrips: {
    entryLabel: "Cantrips used",
    averageLabel: "Total Avg Damage",
    emptyMessage:
      "No cantrip counts selected yet. Set one or more counts above 0 to include them.",
    showDpr: true,
  },
  spells: {
    entryLabel: "Spells used",
    averageLabel: "Total Avg Damage",
    emptyMessage:
      "No spell counts selected yet. Set one or more counts above 0 to include them.",
    showDpr: true,
  },
  healing: {
    entryLabel: "Healing entries used",
    averageLabel: "Total Avg Healing",
    emptyMessage:
      "No healing counts selected yet. Set one or more counts above 0 to include them.",
    showDpr: false,
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
      selectMember: AnalystDialog.#onSelectMember,
    },
  };

  static PARTS = {
    controls: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-controls.hbs`,
    },
    memberTabs: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-member-tabs.hbs`,
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

  /** Count per actor/entry pair for row totals */
  #entryCounts = {};

  /** Active group member actor ID (null = not a group, or first member) */
  #activeMemberId = null;

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

  get title() {
    if (this.#actor?.type === "group") {
      const member = this.#getEffectiveActor();
      return member
        ? `Damage Analyst — ${this.#actor.name} › ${member.name}`
        : `Damage Analyst — ${this.#actor.name}`;
    }
    return this.#actor ? `Damage Analyst — ${this.#actor.name}` : "Damage Analyst";
  }

  /** Re-open singleton rather than stacking windows */
  static open(actor) {
    AnalystDialog.#log("Open requested");
    if (!actor || !AnalystDialog.#canAccessActor(actor)) {
      actor = AnalystDialog.#resolveDefaultActor();
    }

    const existing = Object.values(ui.windows).find(
      (w) => w instanceof AnalystDialog,
    );
    if (existing) {
      AnalystDialog.#log("Reusing existing window");
      existing.bringToTop();
      if (AnalystDialog.#canAccessActor(actor)) {
        if (existing.#actor?.id !== actor?.id) existing.#activeMemberId = null;
        existing.#actor = actor;
      }
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
    });
    // Resolve active group member before computing
    if (this.#actor?.type === "group") {
      const members = this.#getGroupMembers();
      const isValid =
        this.#activeMemberId === "all" ||
        members.some((m) => m.id === this.#activeMemberId);
      if (members.length && !isValid) this.#activeMemberId = "all";
    } else {
      this.#activeMemberId = null;
    }

    this.#compute();
    this.tabGroups.primary ??= this.#getPreferredTab();

    const isGroup = this.#actor?.type === "group";
    const groupMembers = isGroup
      ? [
          { id: "all", name: "All", img: this.#actor.img, active: this.#activeMemberId === "all" },
          ...this.#getGroupMembers().map((m) => ({
            id: m.id,
            name: m.name,
            img: m.img,
            active: m.id === this.#activeMemberId,
          })),
        ]
      : [];

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
      results: this.#results,
      tabs: this._prepareTabs("primary"),
      isGroup,
      groupMembers,
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

    return {
      ...baseContext,
      category: CATEGORY_TABS[partId],
      entries: this.#results[partId],
      hasEntries: this.#results[partId].length > 0,
      emptyMessage: this.#getEmptyMessage(partId),
      summary: this.#getCategorySummary(partId, this.#results[partId]),
      tab: baseContext.tabs[partId],
    };
  }

  // -------------------------------------------------------------------------
  // Core computation
  // -------------------------------------------------------------------------

  #compute() {
    if (this.#actor?.type === "group" && this.#activeMemberId === "all") {
      this.#computeAllMembers();
      return;
    }

    const actor = this.#getEffectiveActor();
    AnalystDialog.#log("#compute called", {
      actor: actor?.name ?? null,
      actorId: actor?.id ?? null,
    });

    if (!actor) {
      this.#results = { weapons: [], cantrips: [], spells: [], healing: [] };
      AnalystDialog.#warn("#compute aborted: no actor selected");
      return;
    }

    const { weapons, cantrips, spells, healing } = extractItems(actor);

    this.#results = {
      weapons: weapons.map((d) =>
        this.#runCalc(d, { count: this.#getEntryCount(d.id) }),
      ),
      cantrips: cantrips.map((d) =>
        this.#runCalc(d, { count: this.#getEntryCount(d.id) }),
      ),
      spells: spells.map((d) =>
        this.#runCalc(d, { count: this.#getEntryCount(d.id) }),
      ),
      healing: healing.map((d) =>
        this.#runCalc(d, { count: this.#getEntryCount(d.id) }),
      ),
    };

    AnalystDialog.#log("#compute completed", {
      actor: actor.name,
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

  #computeAllMembers() {
    const members = this.#getGroupMembers();
    if (!members.length) {
      this.#results = { weapons: [], cantrips: [], spells: [], healing: [] };
      return;
    }
    const combined = { weapons: [], cantrips: [], spells: [], healing: [] };
    for (const member of members) {
      const { weapons, cantrips, spells, healing } = extractItems(member);
      const count = (entryId) => this.#entryCounts[`${member.id}:${entryId}`] ?? 0;
      combined.weapons.push(...weapons.map((d) => this.#runCalc(d, { count: count(d.id) })));
      combined.cantrips.push(...cantrips.map((d) => this.#runCalc(d, { count: count(d.id) })));
      combined.spells.push(...spells.map((d) => this.#runCalc(d, { count: count(d.id) })));
      combined.healing.push(...healing.map((d) => this.#runCalc(d, { count: count(d.id) })));
    }
    this.#results = combined;
  }

  #runCalc(itemData, { count = 0 } = {}) {
    const base = {
      id: itemData.id,
      itemId: itemData.itemId,
      activityId: itemData.activityId,
      name: itemData.name,
      img: itemData.img,
      activation: itemData.activation,
      damageType: itemData.damageType,
      formula: itemData.formula,
      count,
    };

    if (itemData.kind === "healing") {
      const healing = calcHealingItem({
        formula: itemData.formula,
      });

      return {
        ...base,
        healingType: itemData.healingType,
        totalAvgHeal: this.#round2((healing.avgHeal ?? 0) * count),
        ...healing,
      };
    }

    if (itemData.kind === "attack") {
      return {
        ...base,
        ...calcAttackItem({
          formula: itemData.formula,
          attackBonus: itemData.attackBonus,
          targetAC: this.#targetAC,
          critMin: this.#critMin,
          attackCount: count,
        }),
      };
    }

    // save spell
    const save = calcSaveItem({
      formula: itemData.formula,
      saveDC: this.#saveDCOverride ?? itemData.saveDC,
      saveAbility: itemData.saveAbility,
      halfOnSave: itemData.halfOnSave,
    });

    return {
      ...base,
      ...save,
      singleUseDpr: save.dpr,
      dpr: this.#round2((save.dpr ?? 0) * count),
    };
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  /** Delegated from data-action="recompute" (any control change) */
  static #onRecompute(_event, _target) {
    this.render();
  }

  /** Delegated from data-action="selectMember" on group member tabs */
  static #onSelectMember(_event, target) {
    const memberId = target.dataset.memberId;
    if (memberId && memberId !== this.#activeMemberId) {
      this.#activeMemberId = memberId;
      this.render();
    }
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

    if (CATEGORY_ORDER.includes(partId)) {
      AnalystDialog.#log("_attachPartListeners binding row count listeners", {
        elementType: htmlElement.constructor?.name ?? null,
        partId,
      });

      htmlElement.querySelectorAll(".da-entry-count").forEach((input) => {
        input.addEventListener("change", (e) => {
          const entryId = e.currentTarget?.dataset?.entryId;
          if (!entryId) return;

          const parsed = parseInt(e.currentTarget.value, 10);
          const count = Number.isFinite(parsed)
            ? Math.max(0, parsed)
            : 0;

          this.#setEntryCount(entryId, count);
          this.render();
        });
      });

      htmlElement.querySelectorAll(".da-open-item").forEach((button) => {
        button.addEventListener("click", (e) => {
          e.preventDefault();
          const itemId = e.currentTarget?.dataset?.itemId;
          this.#openItemSheet(itemId);
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
        this.#activeMemberId = null;
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
    if (!this.#getEffectiveActor() && this.#activeMemberId !== "all") return "No accessible members found in this group.";

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

  #getEntryCountKey(entryId) {
    return `${this.#getEffectiveActor()?.id ?? "none"}:${entryId}`;
  }

  #getEntryCount(entryId) {
    return this.#entryCounts[this.#getEntryCountKey(entryId)] ?? 0;
  }

  #setEntryCount(entryId, count) {
    this.#entryCounts[this.#getEntryCountKey(entryId)] = count;
  }

  #openItemSheet(itemId) {
    if (!itemId) return;
    const actor = this.#getEffectiveActor();
    if (actor) {
      actor.items.get(itemId)?.sheet?.render?.(true);
      return;
    }
    for (const member of this.#getGroupMembers()) {
      const item = member.items.get(itemId);
      if (item) { item.sheet?.render?.(true); return; }
    }
  }

  #getGroupMembers() {
    if (this.#actor?.type !== "group") return [];
    const result = [];
    for (const { actor } of this.#actor.system.members ?? []) {
      if (actor && AnalystDialog.#canAccessActor(actor)) result.push(actor);
    }
    return result;
  }

  #getEffectiveActor() {
    if (this.#actor?.type !== "group") return this.#actor;
    if (this.#activeMemberId === "all") return null;
    const members = this.#getGroupMembers();
    if (!members.length) return null;
    return members.find((m) => m.id === this.#activeMemberId) ?? members[0];
  }

  #getCategorySummary(partId, entries) {
    const labels = CATEGORY_SUMMARY_LABELS[partId];
    const activeEntries = entries.filter((entry) => (entry.count ?? 0) > 0);

    const totals = activeEntries.reduce(
      (summary, entry) => {
        summary.entryCount += 1;
        summary.totalCount += entry.count ?? 0;
        summary.dpr += entry.dpr ?? 0;
        summary.totalAverage +=
          this.#getAveragePerUse(entry) * (entry.count ?? 0);
        return summary;
      },
      { entryCount: 0, totalCount: 0, dpr: 0, totalAverage: 0 },
    );

    return {
      entryLabel: labels.entryLabel,
      averageLabel: labels.averageLabel,
      emptyMessage: labels.emptyMessage,
      showDpr: labels.showDpr,
      combinedFormula: summarizeFormulae(
        activeEntries.map((entry) => ({
          formula: entry.formula,
          count: entry.count ?? 0,
        })),
      ),
      hasActiveEntries: activeEntries.length > 0,
      entryCount: totals.entryCount,
      totalCount: totals.totalCount,
      dpr: this.#round2(totals.dpr),
      totalAverage: this.#round2(totals.totalAverage),
    };
  }

  #getAveragePerUse(entry) {
    if (typeof entry.avgHeal === "number") return entry.avgHeal;
    if (typeof entry.avgHit === "number") return entry.avgHit;
    if (typeof entry.avgFull === "number") return entry.avgFull;
    return 0;
  }

  #round2(n) {
    return Math.round(n * 100) / 100;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  static #resolveDefaultActor() {
    return (
      AnalystDialog.#getControlledActor()
      ?? AnalystDialog.#getUserCharacter()
      ?? AnalystDialog.#getHoveredNpcActor()
      ?? null
    );
  }

  static #getUserCharacter() {
    const actor = game.user.character ?? null;
    return AnalystDialog.#canAccessActor(actor) ? actor : null;
  }

  static #getControlledActor() {
    const controlled = canvas.tokens?.controlled ?? [];
    const token = controlled[0] ?? null;
    const actor = token?.actor ?? null;
    return AnalystDialog.#canAccessActor(actor) ? actor : null;
  }

  static #getHoveredNpcActor() {
    const hover = canvas.tokens?.hover;
    const hovered = hover?.actor
      ? hover
      : canvas.tokens?.placeables?.find((t) => t.hover);
    const actor = hovered?.actor ?? null;
    if (actor?.type !== "npc") return null;
    return AnalystDialog.#canAccessActor(actor) ? actor : null;
  }

  static #getSelectableActors(selectedActor = null) {
    const actors = game.actors.filter(
      (a) => (a.type === "character" || a.type === "group") && AnalystDialog.#canAccessActor(a),
    );
    const extras = [AnalystDialog.#getHoveredNpcActor(), selectedActor].filter(
      (a) => (a?.type === "npc") && AnalystDialog.#canAccessActor(a),
    );

    for (const extra of extras) {
      if (extra && !actors.some((a) => a.id === extra.id))
        actors.unshift(extra);
    }

    return actors;
  }

  static #canAccessActor(actor) {
    if (!actor) return false;
    if (game.user.isGM) return true;

    return (
      actor.testUserPermission?.(game.user, "OBSERVER") ??
      actor.isOwner ??
      false
    );
  }
}
