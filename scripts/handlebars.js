/**
 * scripts/handlebars.js
 * Register custom Handlebars helpers and partials used by the module.
 * Called once from main.js on the "init" hook.
 */

export function registerHandlebarsHelpers() {

  // Simple equality check for use in templates
  Handlebars.registerHelper("eq", (a, b) => a === b);

  // Partial: one table row for a spell or cantrip, handling both attack and save types
  Handlebars.registerPartial("da-spell-row", `
    <tr>
      <td class="da-col-name">
        <div class="da-name-cell">
          {{#if this.img}}<img class="da-icon" src="{{this.img}}" alt="">{{/if}}
          <span class="da-name-text">{{this.name}}</span>
        </div>
      </td>
      <td>{{this.activation}}</td>
      <td class="da-type">{{this.damageType}}</td>
      <td class="da-mono">{{this.formula}}</td>

      {{!-- DC / Hit column --}}
      {{#if (eq this.type "save")}}
        <td>DC {{this.saveDC}} {{this.saveAbility}}</td>
        <td class="da-num">{{this.avgFull}}</td>
        <td class="da-num">{{this.avgSave}}{{#unless this.halfOnSave}} <span class="da-tag">0</span>{{/unless}}</td>
      {{else}}
        <td>{{this.hitChance}}% / {{this.critChance}}%</td>
        <td class="da-num">{{this.avgHit}}</td>
        <td class="da-num">—</td>
      {{/if}}

      <td class="da-num da-dpr">{{this.dpr}}</td>
      <td class="da-mono">{{this.minDmg}}–{{this.maxDmg}}</td>
    </tr>
  `);

  Handlebars.registerPartial("da-healing-row", `
    <tr>
      <td class="da-col-name">
        <div class="da-name-cell">
          {{#if this.img}}<img class="da-icon" src="{{this.img}}" alt="">{{/if}}
          <span class="da-name-text">{{this.name}}</span>
        </div>
      </td>
      <td>{{this.activation}}</td>
      <td class="da-type">{{this.healingType}}</td>
      <td class="da-mono">{{this.formula}}</td>
      <td>—</td>
      <td>—</td>
      <td class="da-num">{{this.avgHeal}}</td>
      <td>—</td>
      <td class="da-mono">{{this.minHeal}}–{{this.maxHeal}}</td>
    </tr>
  `);
}
