/**
 * scripts/main.js
 * Module entry point.
 * Registers the sidebar button and wires up the AnalystDialog.
 */

import { MODULE_ID, MODULE_TITLE }      from "./constants.js";
import { AnalystDialog }                from "./apps/AnalystDialog.js";
import { registerHandlebarsHelpers }    from "./handlebars.js";

const SETTING_TOKEN_CONTROL = "showTokenControl";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerHandlebarsHelpers();
  console.log(`${MODULE_ID} | Handlebars helpers registered`);

  // Per-user toggle for the Token Controls button (keeps the toolbar uncluttered).
  game.settings.register(MODULE_ID, SETTING_TOKEN_CONTROL, {
    name: "Token Controls button",
    hint: "Show a Damage Analyst button in the Token Controls toolbar. Disable to reduce toolbar clutter — you can still use the actor-sheet header button.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ui.controls?.render({ reset: true }),
  });

  // Public API — used by exported macros to reopen the dialog with a preset state.
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      open: (actor) => AnalystDialog.open(actor),
      openWithState: (state) => AnalystDialog.openWithState(state),
      openFromSelectedTokens: () => AnalystDialog.openFromSelectedTokens(),
      AnalystDialog,
    };
  }
});

// ---------------------------------------------------------------------------
// Token Controls button — analyse the selected tokens (as a temporary group)
// ---------------------------------------------------------------------------

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.settings.get(MODULE_ID, SETTING_TOKEN_CONTROL)) return;

  const onActivate = () => AnalystDialog.openFromSelectedTokens();

  // Foundry v13: `controls` is a record keyed by control name; tools is a record.
  // Button tools dispatch via `onChange` — do NOT also set `onClick`, or v13
  // fires both handlers (and the dialog opens / warns twice).
  if (!Array.isArray(controls)) {
    const tokenControl = controls.tokens ?? controls.token;
    if (!tokenControl?.tools) return;
    tokenControl.tools["damage-analyst"] = {
      name: "damage-analyst",
      title: MODULE_TITLE,
      icon: "fa-solid fa-chart-column",
      button: true,
      order: Object.keys(tokenControl.tools).length,
      onChange: onActivate,
    };
    return;
  }

  // Foundry v12: `controls` is an array of control groups; tools is an array (onClick).
  const tokenControl = controls.find(
    (c) => c.name === "token" || c.name === "tokens",
  );
  tokenControl?.tools?.push({
    name: "damage-analyst",
    title: MODULE_TITLE,
    icon: "fa-solid fa-chart-column",
    button: true,
    onClick: onActivate,
  });
});

// ---------------------------------------------------------------------------
// Actor sheet header button (AppV2)
// ---------------------------------------------------------------------------

Hooks.on("getHeaderControlsActorSheetV2", (_sheet, controls) => {
  controls.push({
    icon:   "fa-solid fa-chart-column",
    label:  MODULE_TITLE,
    action: "open-damage-analyst",
  });
});

Hooks.on("renderActorSheetV2", (app) => {
  if (app.element.dataset.daWired) return;
  app.element.dataset.daWired = "1";

  app.element.addEventListener("click", (e) => {
    if (!e.target.closest('[data-action="open-damage-analyst"]')) return;
    e.stopPropagation();
    AnalystDialog.open(app.document);
  }, true);
});

// ---------------------------------------------------------------------------
// Auto-update AC when user changes their target
// ---------------------------------------------------------------------------

Hooks.on("targetToken", (_user, _token, _targeted) => {
  console.log(`${MODULE_ID} | targetToken fired`);
  // If the dialog is open, re-render so the AC field refreshes
  const dialog = Object.values(ui.windows).find(w => w instanceof AnalystDialog);
  dialog?.render();
});

// ---------------------------------------------------------------------------
// Ready log
// ---------------------------------------------------------------------------

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Module loaded — click the chart button on any actor sheet to open.`);
});
