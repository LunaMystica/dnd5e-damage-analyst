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
// Sidebar button
// ---------------------------------------------------------------------------

/**
 * Inject a button into the Actors sidebar header.
 * Targets the [data-tab="actors"] panel's .directory-header.
 */
Hooks.on("renderActorDirectory", (app, html) => {
  console.log(`${MODULE_ID} | renderActorDirectory`, {
    appId: app?.id ?? null,
    existingButton: Boolean(html.querySelector(`#damage-analyst-sidebar-btn`)),
  });

  // Avoid duplicates on re-render
  if (html.querySelector(`#damage-analyst-sidebar-btn`)) return;

  const btn = document.createElement("button");
  btn.id        = "damage-analyst-sidebar-btn";
  btn.type      = "button";
  btn.title     = MODULE_TITLE;
  btn.innerHTML = `<i class="fa-solid fa-chart-column"></i> ${MODULE_TITLE}`;
  btn.classList.add("da-sidebar-btn");

  btn.addEventListener("click", () => {
    console.log(`${MODULE_ID} | sidebar button clicked`);
    AnalystDialog.open();
  });

  // Insert before the existing Create Actor button
  const headerActions = html.querySelector(".header-actions")
                     ?? html.querySelector(".directory-header");
  if (headerActions) headerActions.prepend(btn);
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
  console.log(`${MODULE_ID} | Module loaded — click the Actors sidebar button to open.`);
});
