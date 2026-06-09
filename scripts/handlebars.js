/**
 * scripts/handlebars.js
 * Register custom Handlebars helpers and partials used by the module.
 * Called once from main.js on the "init" hook.
 */

export function registerHandlebarsHelpers() {

  // Simple equality check for use in templates
  Handlebars.registerHelper("eq", (a, b) => a === b);

  // Partial: the sticky totals bar shown above each category table.
  // Context is the part-level `summary` object.
  Handlebars.registerPartial("da-summary", `
    <div class="da-summary">
      {{#if this.hasActiveEntries}}
        <span class="da-summary-stat">
          <span class="da-summary-label">{{this.entryLabel}}</span>
          <span class="da-summary-value">{{this.totalCount}}</span>
        </span>
        {{#if this.showDpr}}
          <span class="da-summary-stat da-summary-stat--accent">
            <span class="da-summary-label">Total DPR</span>
            <span class="da-summary-value">{{this.dpr}}</span>
          </span>
        {{/if}}
        <span class="da-summary-stat da-summary-stat--accent">
          <span class="da-summary-label">{{this.averageLabel}}</span>
          <span class="da-summary-value">{{this.totalAverage}}</span>
        </span>
        <span class="da-summary-stat da-summary-stat--formula">
          <span class="da-summary-label">Combined</span>
          <span class="da-summary-value da-mono">{{this.combinedFormula}}</span>
        </span>
      {{else}}
        <span class="da-summary-empty">{{this.emptyMessage}}</span>
      {{/if}}
    </div>
  `);

  // Partial: name cell with icon, clickable item link, and optional owner sub-label.
  // Pass `showOwner` via hash, e.g. {{> da-entry-name this showOwner=../showOwner}}
  Handlebars.registerPartial("da-entry-name", `
    <td class="da-col-name">
      <div class="da-name-cell">
        {{#if this.img}}<img class="da-icon" src="{{this.img}}" alt="">{{/if}}
        <div class="da-name-stack">
          <button
            type="button"
            class="da-open-item"
            data-item-id="{{this.itemId}}"
            data-actor-id="{{this.ownerId}}"
            title="Open item sheet"
          >{{#if this.displayName}}{{this.displayName}}{{else}}{{this.name}}{{/if}}</button>
          {{#if showOwner}}
            <span class="da-owner" title="{{this.ownerName}}">
              {{#if this.ownerImg}}<img class="da-owner-icon" src="{{this.ownerImg}}" alt="">{{/if}}
              {{this.ownerName}}
            </span>
          {{/if}}
        </div>
      </div>
    </td>
  `);

  // Partial: a -/+ stepper around the count input.
  Handlebars.registerPartial("da-count-cell", `
    <td class="da-count-cell">
      <div class="da-stepper">
        <button
          type="button"
          class="da-step da-step--minus"
          data-entry-id="{{this.id}}"
          data-actor-id="{{this.ownerId}}"
          data-delta="-1"
          tabindex="-1"
          aria-label="Decrease count"
        ><i class="fa-solid fa-minus"></i></button>
        <input
          class="da-entry-count"
          type="number"
          inputmode="numeric"
          min="0"
          step="1"
          value="{{this.count}}"
          data-entry-id="{{this.id}}"
          data-actor-id="{{this.ownerId}}"
        >
        <button
          type="button"
          class="da-step da-step--plus"
          data-entry-id="{{this.id}}"
          data-actor-id="{{this.ownerId}}"
          data-delta="1"
          tabindex="-1"
          aria-label="Increase count"
        ><i class="fa-solid fa-plus"></i></button>
      </div>
    </td>
  `);

  // Partial: one table row for a spell or cantrip, handling both attack and save types
  Handlebars.registerPartial("da-spell-row", `
    <tr class="{{#if this.count}}da-row--active{{/if}}">
      {{> da-entry-name this showOwner=showOwner}}
      <td>{{this.activation}}</td>
      <td class="da-range-dist">{{this.range}}</td>
      <td class="da-type">{{this.damageType}}</td>
      <td class="da-mono">{{this.formula}}</td>

      {{!-- DC / Hit column --}}
      {{#if (eq this.type "save")}}
        <td>DC {{this.saveDC}} {{this.saveAbility}}</td>
        <td class="da-num">—</td>
        <td class="da-num">{{this.avgFull}}</td>
        <td class="da-num">{{this.avgSave}}{{#unless this.halfOnSave}} <span class="da-tag">0</span>{{/unless}}</td>
      {{else if (eq this.type "damage")}}
        <td><span class="da-tag">auto</span></td>
        <td class="da-num">—</td>
        <td class="da-num">{{this.avgDamage}}</td>
        <td class="da-num">—</td>
      {{else}}
        <td>{{this.hitChance}}%</td>
        <td>{{#if this.forceCrit}}<span class="da-tag da-tag--crit">CRIT</span>{{else}}{{this.critChance}}%{{/if}}</td>
        <td class="da-num">{{this.avgHit}}</td>
        <td class="da-num">—</td>
      {{/if}}

      {{> da-count-cell this}}
      <td class="da-num da-dpr">{{this.dpr}}</td>
      <td class="da-mono da-range">{{this.minDmg}}–{{this.maxDmg}}</td>
    </tr>
  `);

  Handlebars.registerPartial("da-healing-row", `
    <tr class="{{#if this.count}}da-row--active{{/if}}">
      {{> da-entry-name this showOwner=showOwner}}
      <td>{{this.activation}}</td>
      <td class="da-range-dist">{{this.range}}</td>
      <td class="da-type">{{this.healingType}}</td>
      <td class="da-mono">{{this.formula}}</td>
      <td class="da-num">{{this.avgHeal}}</td>
      {{> da-count-cell this}}
      <td class="da-num da-dpr">{{this.totalAvgHeal}}</td>
      <td class="da-mono da-range">{{this.minHeal}}–{{this.maxHeal}}</td>
    </tr>
  `);
}
