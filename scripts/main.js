/**
 * scripts/main.js
 * Module entry point.
 * Registers the sidebar button and wires up the AnalystDialog.
 */

import { MODULE_ID, MODULE_TITLE }      from "./constants.js";
import { AnalystDialog }                from "./apps/AnalystDialog.js";
import { registerHandlebarsHelpers }    from "./handlebars.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerHandlebarsHelpers();
  console.log(`${MODULE_ID} | Handlebars helpers registered`);
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
