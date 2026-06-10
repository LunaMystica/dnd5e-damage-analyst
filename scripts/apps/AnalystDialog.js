/**
 * apps/AnalystDialog.js
 * Main damage analysis window.
 * Uses Foundry v12 ApplicationV2 + HandlebarsApplicationMixin.
 */

import { MODULE_ID, DEFAULTS } from "../constants.js";
import { extractItems, getTargetAC } from "../calc/extractor.js";
import {
  calcAttackItem,
  calcDamageItem,
  calcHealingItem,
  calcSaveItem,
  summarizeFormulae,
} from "../calc/engine.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } =
  foundry.applications.api;
const CATEGORY_ORDER = ["weapons", "cantrips", "spells", "features", "healing"];
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
  features: {
    icon: "fa-solid fa-hand-fist",
    label: "Features",
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
  features: {
    entryLabel: "Features used",
    averageLabel: "Total Avg Damage",
    emptyMessage:
      "No feature counts selected yet. Set one or more counts above 0 to include them.",
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
      scrollable: [".da-table-wrap"],
    },
    cantrips: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-cantrips.hbs`,
      scrollable: [".da-table-wrap"],
    },
    spells: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-spells.hbs`,
      scrollable: [".da-table-wrap"],
    },
    features: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-features.hbs`,
      scrollable: [".da-table-wrap"],
    },
    healing: {
      template: `modules/${MODULE_ID}/templates/analyst-dialog-healing.hbs`,
      scrollable: [".da-table-wrap"],
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

  /** @type {boolean} Treat every attack roll as a guaranteed crit */
  #forceCrit = false;

  /** @type {boolean} Include NPC actors in the selector */
  #includeNpcs = false;

  /**
   * Tri-state "always show activity name" toggle.
   * null = follow the per-tab default (on for Features); true/false = user override.
   * @type {boolean|null}
   */
  #showActivityName = null;

  /** Count per actor/entry pair for row totals (key: `${actorId}:${entryId}`) */
  #entryCounts = {};

  /** @type {string[]} Actor IDs forming an ad-hoc temporary group */
  #tempGroupIds = [];

  /** Active group member actor ID ("all", a member id, or null when single) */
  #activeMemberId = null;

  /** Computed results — set by #compute() */
  #results = { weapons: [], cantrips: [], spells: [], features: [], healing: [] };

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
    if (this.#isMultiActor()) {
      const groupName = this.#isTempGroup()
        ? "Temporary Group"
        : (this.#actor?.name ?? "Group");
      const member = this.#getEffectiveActor();
      return member
        ? `Damage Analyst — ${groupName} › ${member.name}`
        : `Damage Analyst — ${groupName}`;
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

  /**
   * Open (or refocus) the dialog with a fully pre-set state. Used by exported macros.
   * @param {object} state
   * @param {string|null} [state.actorId]       anchor actor id (single actor or saved group)
   * @param {string[]}    [state.tempGroupIds]  ad-hoc temporary group actor ids
   * @param {number}      [state.targetAC]
   * @param {number}      [state.critMin]
   * @param {number|null} [state.saveDCOverride]
   * @param {boolean}     [state.forceCrit]
   * @param {object}      [state.entryCounts]   map of `${actorId}:${entryId}` → count
   * @param {string|null} [state.activeMemberId]
   * @returns {AnalystDialog}
   */
  static openWithState(state = {}) {
    AnalystDialog.#log("openWithState requested", state);
    const anchor = state.actorId ? game.actors.get(state.actorId) : null;

    let dialog = Object.values(ui.windows).find(
      (w) => w instanceof AnalystDialog,
    );
    if (dialog) {
      dialog.bringToTop();
    } else {
      dialog = new AnalystDialog({
        actor: anchor ?? AnalystDialog.#resolveDefaultActor(),
      });
    }

    dialog.#applyState(state);
    dialog.render(true);
    return dialog;
  }

  /**
   * Open the dialog using the currently controlled canvas tokens. Two or more
   * accessible actors become a temporary group; a single one opens directly.
   * @returns {AnalystDialog}
   */
  static openFromSelectedTokens() {
    const tokens = canvas?.tokens?.controlled ?? [];
    const ids = [];
    const seen = new Set();
    for (const token of tokens) {
      const actor = token.actor;
      if (actor && AnalystDialog.#canAccessActor(actor) && !seen.has(actor.id)) {
        seen.add(actor.id);
        ids.push(actor.id);
      }
    }

    AnalystDialog.#log("openFromSelectedTokens", { tokenCount: tokens.length, actorIds: ids });

    if (!ids.length) {
      ui.notifications?.warn(
        "Damage Analyst: select one or more tokens to analyse.",
      );
      return AnalystDialog.open();
    }
    if (ids.length === 1) {
      return AnalystDialog.openWithState({ actorId: ids[0], tempGroupIds: [] });
    }
    return AnalystDialog.openWithState({
      tempGroupIds: ids,
      activeMemberId: "all",
    });
  }

  #applyState(state = {}) {
    if (state.actorId) {
      const actor = game.actors.get(state.actorId);
      if (actor && AnalystDialog.#canAccessActor(actor)) this.#actor = actor;
    }

    this.#tempGroupIds = Array.isArray(state.tempGroupIds)
      ? state.tempGroupIds.filter((id) => {
          const actor = game.actors.get(id);
          return actor && AnalystDialog.#canAccessActor(actor);
        })
      : [];

    if (Number.isFinite(state.targetAC)) this.#targetAC = state.targetAC;
    if (Number.isFinite(state.critMin))
      this.#critMin = Math.min(20, Math.max(1, state.critMin));
    if (state.saveDCOverride === null || Number.isFinite(state.saveDCOverride))
      this.#saveDCOverride = state.saveDCOverride;
    if (typeof state.forceCrit === "boolean") this.#forceCrit = state.forceCrit;
    if (typeof state.includeNpcs === "boolean")
      this.#includeNpcs = state.includeNpcs;
    if (state.showActivityName === null || typeof state.showActivityName === "boolean")
      this.#showActivityName = state.showActivityName;

    if (state.entryCounts && typeof state.entryCounts === "object") {
      this.#entryCounts = { ...state.entryCounts };
    }

    if (typeof state.activeMemberId === "string" || state.activeMemberId === null) {
      this.#activeMemberId = state.activeMemberId;
    }
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
    if (this.#isMultiActor()) {
      const members = this.#getGroupMembers();
      const isValid =
        this.#activeMemberId === "all" ||
        members.some((m) => m.id === this.#activeMemberId);
      if (members.length && !isValid) this.#activeMemberId = "all";
    } else {
      this.#activeMemberId = null;
    }

    this.#compute();
    this.#applyDisplayNames();
    this.tabGroups.primary ??= this.#getPreferredTab();

    const isMultiActor = this.#isMultiActor();
    const members = this.#getGroupMembers();
    const groupMembers = isMultiActor
      ? [
          {
            id: "all",
            name: "All",
            img: this.#isTempGroup() ? null : this.#actor?.img,
            active: this.#activeMemberId === "all",
          },
          ...members.map((m) => ({
            id: m.id,
            name: m.name,
            img: m.img,
            active: m.id === this.#activeMemberId,
          })),
        ]
      : [];

    const tempGroupMembers = this.#isTempGroup()
      ? members.map((m) => ({ id: m.id, name: m.name, img: m.img }))
      : [];

    const { players, npcs } = this.#getActorOptions();
    const notInTemp = (a) =>
      a.type !== "group" && !this.#tempGroupIds.includes(a.id);
    const addablePlayers = players.filter(notInTemp);
    const addableNpcs = npcs.filter(notInTemp);
    const context = await super._prepareContext(options);
    AnalystDialog.#log("_prepareContext actor list prepared", {
      playerCount: players.length,
      npcCount: npcs.length,
      resultCounts: {
        weapons: this.#results.weapons.length,
        cantrips: this.#results.cantrips.length,
        spells: this.#results.spells.length,
        features: this.#results.features.length,
        healing: this.#results.healing.length,
      },
    });

    return {
      ...context,
      playerActors: players,
      npcActors: npcs,
      addablePlayers,
      addableNpcs,
      hasAddable: addablePlayers.length + addableNpcs.length > 0,
      selectedActorId: this.#actor?.id ?? "",
      canOpenActor: Boolean(
        this.#getEffectiveActor() ?? (this.#isRealGroup() ? this.#actor : null),
      ),
      includeNpcs: this.#includeNpcs,
      showActivityName: this.#getShowActivity(
        this.tabGroups.primary ?? CATEGORY_ORDER[0],
      ),
      targetAC: this.#targetAC,
      critMin: this.#critMin,
      saveDCOverride: this.#saveDCOverride,
      forceCrit: this.#forceCrit,
      results: this.#results,
      tabs: this._prepareTabs("primary"),
      isMultiActor,
      isTempGroup: this.#isTempGroup(),
      groupMembers,
      tempGroupMembers,
      canCreateGroup: tempGroupMembers.length > 1,
      hasWeapons: this.#results.weapons.length > 0,
      hasCantrips: this.#results.cantrips.length > 0,
      hasSpells: this.#results.spells.length > 0,
      hasFeatures: this.#results.features.length > 0,
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
      showOwner: this.#isMultiActor() && this.#activeMemberId === "all",
      tab: baseContext.tabs[partId],
    };
  }

  // -------------------------------------------------------------------------
  // Core computation
  // -------------------------------------------------------------------------

  #compute() {
    if (this.#isMultiActor() && this.#activeMemberId === "all") {
      this.#computeAllMembers();
      return;
    }

    const actor = this.#getEffectiveActor();
    AnalystDialog.#log("#compute called", {
      actor: actor?.name ?? null,
      actorId: actor?.id ?? null,
    });

    if (!actor) {
      this.#results = { weapons: [], cantrips: [], spells: [], features: [], healing: [] };
      AnalystDialog.#warn("#compute aborted: no actor selected");
      return;
    }

    const { weapons, cantrips, spells, healing, features } =
      extractItems(actor);
    const owner = { id: actor.id, name: actor.name, img: actor.img };
    const run = (d) =>
      this.#runCalc(d, { count: this.#getEntryCount(actor.id, d.id), owner });

    this.#results = {
      weapons: weapons.map(run),
      cantrips: cantrips.map(run),
      spells: spells.map(run),
      features: features.map(run),
      healing: healing.map(run),
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
      this.#results = { weapons: [], cantrips: [], spells: [], features: [], healing: [] };
      return;
    }
    const combined = { weapons: [], cantrips: [], spells: [], features: [], healing: [] };
    for (const member of members) {
      const { weapons, cantrips, spells, healing, features } =
        extractItems(member);
      const owner = { id: member.id, name: member.name, img: member.img };
      const run = (d) =>
        this.#runCalc(d, { count: this.#getEntryCount(member.id, d.id), owner });
      combined.weapons.push(...weapons.map(run));
      combined.cantrips.push(...cantrips.map(run));
      combined.spells.push(...spells.map(run));
      combined.features.push(...features.map(run));
      combined.healing.push(...healing.map(run));
    }
    this.#results = combined;
  }

  #runCalc(itemData, { count = 0, owner = null } = {}) {
    const base = {
      id: itemData.id,
      itemId: itemData.itemId,
      activityId: itemData.activityId,
      name: itemData.name,
      nameFull: itemData.nameFull ?? itemData.name,
      range: itemData.range ?? "—",
      img: itemData.img,
      activation: itemData.activation,
      damageType: itemData.damageType,
      formula: itemData.formula,
      count,
      ownerId: owner?.id ?? null,
      ownerName: owner?.name ?? null,
      ownerImg: owner?.img ?? null,
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
          forceCrit: this.#forceCrit,
        }),
      };
    }

    if (itemData.kind === "damage") {
      const dmg = calcDamageItem({ formula: itemData.formula, useCount: count });
      return {
        ...base,
        ...dmg,
        singleUseDpr: dmg.singleUseDpr,
        dpr: dmg.dpr,
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

  /**
   * Keep the "Activity names" checkbox in sync with the per-tab default while
   * the toggle is in auto mode. Entry names are baked per-category at render
   * time, so no full re-render is needed here.
   */
  changeTab(tab, group, options) {
    super.changeTab(tab, group, options);
    if (group !== "primary" || this.#showActivityName !== null) return;
    const checkbox = this.element?.querySelector("#da-show-activity");
    if (checkbox) checkbox.checked = this.#getShowActivity(tab);
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
          const { entryId, actorId } = e.currentTarget?.dataset ?? {};
          if (!entryId) return;

          const parsed = parseInt(e.currentTarget.value, 10);
          const count = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;

          this.#setEntryCount(actorId, entryId, count);
          this.render();
        });
      });

      htmlElement.querySelectorAll(".da-step").forEach((button) => {
        button.addEventListener("click", (e) => {
          e.preventDefault();
          const { entryId, actorId, delta } = e.currentTarget?.dataset ?? {};
          if (!entryId) return;

          const step = parseInt(delta, 10) || 0;
          const current = this.#getEntryCount(actorId, entryId);
          this.#setEntryCount(actorId, entryId, current + step);
          this.render();
        });
      });

      htmlElement.querySelectorAll(".da-open-item").forEach((button) => {
        button.addEventListener("click", (e) => {
          e.preventDefault();
          const { itemId, actorId } = e.currentTarget?.dataset ?? {};
          this.#openItemSheet(itemId, actorId);
        });
      });

      return;
    }

    if (partId !== "controls") return;

    AnalystDialog.#log("_attachPartListeners binding control listeners", {
      elementType: htmlElement.constructor?.name ?? null,
    });

    // Actor selector — picking a single subject resets any temporary group
    htmlElement
      .querySelector("#da-actor-select")
      ?.addEventListener("change", (e) => {
        this.#activeMemberId = null;
        this.#tempGroupIds = [];
        this.#actor = game.actors.get(e.target.value) ?? null;
        this.render();
      });

    // Temporary group: add an actor
    htmlElement
      .querySelector("#da-temp-add")
      ?.addEventListener("change", (e) => {
        const id = e.target.value;
        if (id && !this.#tempGroupIds.includes(id)) {
          this.#tempGroupIds.push(id);
          this.#activeMemberId = "all";
        }
        this.render();
      });

    // Temporary group: remove a member chip
    htmlElement.querySelectorAll(".da-chip-remove").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.preventDefault();
        const id = e.currentTarget?.dataset?.actorId;
        this.#tempGroupIds = this.#tempGroupIds.filter((x) => x !== id);
        if (!this.#tempGroupIds.length) this.#activeMemberId = null;
        this.render();
      });
    });

    // Temporary group: clear all
    htmlElement
      .querySelector("#da-temp-clear")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        this.#tempGroupIds = [];
        this.#activeMemberId = null;
        this.render();
      });

    // Temporary group: save as a real Group actor
    htmlElement
      .querySelector("#da-create-group")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        this.#maybePromptCreateGroup();
      });

    // Force crits toggle
    htmlElement
      .querySelector("#da-force-crit")
      ?.addEventListener("change", (e) => {
        this.#forceCrit = Boolean(e.target.checked);
        this.render();
      });

    // Export current setup as a macro
    htmlElement
      .querySelector("#da-export-macro")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        this.#exportMacro();
      });

    // Open the current actor's sheet
    htmlElement
      .querySelector("#da-open-actor")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        this.#openCurrentActor();
      });

    // Reset use counts for the current actor / group
    htmlElement
      .querySelector("#da-reset-counts")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        this.#resetCounts();
      });

    // Toggle NPCs in the actor selector
    htmlElement
      .querySelector("#da-include-npcs")
      ?.addEventListener("change", (e) => {
        this.#includeNpcs = Boolean(e.target.checked);
        this.render();
      });

    // Always-show-activity-name toggle (becomes an explicit override)
    htmlElement
      .querySelector("#da-show-activity")
      ?.addEventListener("change", (e) => {
        this.#showActivityName = Boolean(e.target.checked);
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
    if (!this.#actor && !this.#isMultiActor())
      return "Select an actor above to begin.";
    if (this.#isMultiActor() && !this.#getGroupMembers().length)
      return "No accessible members in this group. Add actors above.";
    if (!this.#getEffectiveActor() && this.#activeMemberId !== "all")
      return "No accessible members found in this group.";

    switch (partId) {
      case "weapons":
        return "No weapon entries were found for this actor.";
      case "cantrips":
        return "No cantrip entries matched the current filters.";
      case "spells":
        return "No spell entries matched the current filters.";
      case "features":
        return "No damaging features were found for this actor.";
      case "healing":
        return "No healing entries matched the current filters.";
      default:
        return "No entries found.";
    }
  }

  #getEntryCount(actorId, entryId) {
    return this.#entryCounts[`${actorId ?? "none"}:${entryId}`] ?? 0;
  }

  #setEntryCount(actorId, entryId, count) {
    this.#entryCounts[`${actorId ?? "none"}:${entryId}`] = Math.max(0, count);
  }

  #openItemSheet(itemId, actorId = null) {
    if (!itemId) return;
    if (actorId) {
      const item = game.actors.get(actorId)?.items?.get(itemId);
      if (item) { item.sheet?.render?.(true); return; }
    }
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

  // -------------------------------------------------------------------------
  // Macro export
  // -------------------------------------------------------------------------

  /** Snapshot the current dialog configuration for serialisation. */
  #collectState() {
    const entryCounts = {};
    for (const [key, value] of Object.entries(this.#entryCounts)) {
      if (value > 0) entryCounts[key] = value;
    }
    return {
      actorId: this.#actor?.id ?? null,
      tempGroupIds: [...this.#tempGroupIds],
      targetAC: this.#targetAC,
      critMin: this.#critMin,
      saveDCOverride: this.#saveDCOverride,
      forceCrit: this.#forceCrit,
      includeNpcs: this.#includeNpcs,
      showActivityName: this.#showActivityName,
      entryCounts,
      activeMemberId: this.#activeMemberId,
    };
  }

  #buildMacroCommand(state) {
    const json = JSON.stringify(state, null, 2);
    return [
      "// Damage Analyst — saved setup. Re-opens the dialog with these values.",
      `const api = game.modules.get(${JSON.stringify(MODULE_ID)})?.api;`,
      'if (!api) { ui.notifications?.error("Damage Analyst module is not active."); return; }',
      `api.openWithState(${json});`,
    ].join("\n");
  }

  async #exportMacro() {
    const state = this.#collectState();
    const command = this.#buildMacroCommand(state);
    const subject = this.#isTempGroup()
      ? "Temporary Group"
      : (this.#actor?.name ?? "Setup");
    const name = `Damage Analyst — ${subject}`;

    try {
      const macro = await Macro.create({
        name,
        type: "script",
        scope: "global",
        img: "icons/svg/d20-highlight.svg",
        command,
        flags: { [MODULE_ID]: { state } },
      });
      macro?.sheet?.render(true);
      ui.notifications?.info(
        `Created macro "${name}". Drag it to your hotbar to reuse this setup.`,
      );
    } catch (err) {
      AnalystDialog.#warn("Failed to create macro", err);
      ui.notifications?.error(
        "Failed to create Damage Analyst macro — see console for details.",
      );
    }
  }

  // -------------------------------------------------------------------------
  // Multi-actor / temporary group helpers
  // -------------------------------------------------------------------------

  #isRealGroup() {
    return this.#actor?.type === "group";
  }

  #isTempGroup() {
    return this.#tempGroupIds.length > 0;
  }

  #isMultiActor() {
    return this.#isTempGroup() || this.#isRealGroup();
  }

  #getGroupMembers() {
    if (this.#isTempGroup()) {
      const result = [];
      for (const id of this.#tempGroupIds) {
        const actor = game.actors.get(id);
        if (actor && AnalystDialog.#canAccessActor(actor)) result.push(actor);
      }
      return result;
    }
    if (this.#isRealGroup()) {
      const result = [];
      for (const { actor } of this.#actor.system.members ?? []) {
        if (actor && AnalystDialog.#canAccessActor(actor)) result.push(actor);
      }
      return result;
    }
    return [];
  }

  #getEffectiveActor() {
    if (!this.#isMultiActor()) return this.#actor;
    if (this.#activeMemberId === "all") return null;
    const members = this.#getGroupMembers();
    if (!members.length) return null;
    return members.find((m) => m.id === this.#activeMemberId) ?? members[0];
  }

  /**
   * Build the actor selector options, split into players (characters + groups)
   * and NPCs. NPCs are only listed when {@link #includeNpcs} is on, but the
   * currently-selected/hovered NPC is always kept selectable.
   * @returns {{ players: Actor5e[], npcs: Actor5e[] }}
   */
  #getActorOptions() {
    const accessible = (a) => AnalystDialog.#canAccessActor(a);
    const players = game.actors.filter(
      (a) => (a.type === "character" || a.type === "group") && accessible(a),
    );

    const npcs = [];
    const seen = new Set();
    const pushNpc = (a) => {
      if (a?.type === "npc" && accessible(a) && !seen.has(a.id)) {
        seen.add(a.id);
        npcs.push(a);
      }
    };

    if (this.#includeNpcs) {
      for (const a of game.actors) pushNpc(a);
    }
    pushNpc(AnalystDialog.#getHoveredNpcActor());
    if (this.#actor?.type === "npc") pushNpc(this.#actor);

    players.sort((a, b) => a.name.localeCompare(b.name));
    npcs.sort((a, b) => a.name.localeCompare(b.name));
    return { players, npcs };
  }

  /** Open the sheet of the active member (or the group actor on the All tab). */
  #openCurrentActor() {
    const actor =
      this.#getEffectiveActor() ?? (this.#isRealGroup() ? this.#actor : null);
    if (actor) {
      actor.sheet?.render(true);
      return;
    }

    // A temporary group has no sheet of its own — offer to make it a real group.
    if (this.#isTempGroup()) {
      this.#maybePromptCreateGroup();
      return;
    }

    ui.notifications?.info(
      "Select a specific actor or group member to open its sheet.",
    );
  }

  /** Clear use counts for the current actor (or all members of a group). */
  #resetCounts() {
    const ids = new Set(
      this.#isMultiActor()
        ? this.#getGroupMembers().map((m) => m.id)
        : [this.#getEffectiveActor()?.id ?? this.#actor?.id].filter(Boolean),
    );

    if (!ids.size) {
      this.#entryCounts = {};
    } else {
      for (const key of Object.keys(this.#entryCounts)) {
        if (ids.has(key.split(":")[0])) delete this.#entryCounts[key];
      }
    }
    this.render();
  }

  /** Offer to persist the active temporary group as a real Group actor. */
  async #maybePromptCreateGroup() {
    if (!this.#isTempGroup()) return;

    const members = this.#getGroupMembers();
    if (members.length < 2) return;

    if (!game.user.can("ACTOR_CREATE")) {
      ui.notifications?.warn(
        "You do not have permission to create a Group actor.",
      );
      return;
    }

    const list = members.map((m) => m.name).join(", ");
    let confirmed = false;
    try {
      confirmed = await DialogV2.confirm({
        window: { title: "Save Temporary Group?", icon: "fa-solid fa-people-group" },
        content:
          `<p>This setup uses a temporary group of ${members.length} actors:</p>` +
          `<p><em>${foundry.utils.escapeHTML?.(list) ?? list}</em></p>` +
          `<p>Create a saved <strong>Group</strong> actor from them?</p>`,
        modal: true,
        rejectClose: false,
      });
    } catch {
      confirmed = false;
    }
    if (!confirmed) return;

    const group = await this.#createGroupFromTemp(members);
    if (group) {
      this.#actor = group;
      this.#tempGroupIds = [];
      this.#activeMemberId = "all";
      this.render();
    }
  }

  async #createGroupFromTemp(members) {
    const names = members.map((m) => m.name);
    const label =
      names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "");
    try {
      return await Actor.create({
        name: `Analyst Group (${label})`,
        type: "group",
        img: "icons/svg/mystery-man.svg",
        system: { members: members.map((m) => ({ actor: m.id })) },
      });
    } catch (err) {
      AnalystDialog.#warn("Failed to create group actor", err);
      ui.notifications?.error(
        "Failed to create group actor — see console for details.",
      );
      return null;
    }
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

  /**
   * Effective "show activity name" for a category. Defaults on for Features;
   * a non-null {@link #showActivityName} overrides every category.
   */
  #getShowActivity(category) {
    return this.#showActivityName ?? (category === "features");
  }

  /** Pick each entry's display name based on its category's show-activity setting. */
  #applyDisplayNames() {
    for (const category of CATEGORY_ORDER) {
      const showActivity = this.#getShowActivity(category);
      for (const entry of this.#results[category] ?? []) {
        entry.displayName = showActivity
          ? (entry.nameFull ?? entry.name)
          : entry.name;
      }
    }
  }

  #getAveragePerUse(entry) {
    if (typeof entry.avgHeal === "number") return entry.avgHeal;
    if (typeof entry.avgHit === "number") return entry.avgHit;
    if (typeof entry.avgFull === "number") return entry.avgFull;
    if (typeof entry.avgDamage === "number") return entry.avgDamage;
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
