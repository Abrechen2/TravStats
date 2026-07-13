import type { Decision } from "../model.js";
import { esc } from "./escape.js";

/**
 * Colour carries exactly one meaning each on this page (see style.ts): red
 * for a drift/blocker, amber for "a decision is needed". Every decision kind
 * except "blocked" needs the owner to actively decide something, so amber is
 * the default; a real blocker gets red.
 */
const KIND_CLASS: Record<Decision["kind"], "amber" | "red"> = {
  merge: "amber",
  promote: "amber",
  triage: "amber",
  blocked: "red",
};

/**
 * A decision card is a headline plus at most two lines — anything beyond
 * that is evidence, not summary, and belongs behind a `<details>` toggle so
 * the reader isn't forced through (say) 13 issue titles to see what's
 * blocking a release.
 */
function renderDetail(detail: readonly string[]): string {
  if (detail.length === 0) return "";
  if (detail.length <= 2) {
    return `<ul class="d-lines">${detail.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
  }
  return `<details class="d-more"><summary>${detail.length} Einträge anzeigen</summary>
    <ul>${detail.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
  </details>`;
}

export function renderDecisions(decisions: readonly Decision[]): string {
  if (decisions.length === 0) {
    return `<p class="empty">Nichts zu entscheiden — kein fertiger Branch, keine wartenden Fixes, keine offene Triage.</p>`;
  }
  return decisions
    .map(
      (d) => `<div class="decision ${KIND_CLASS[d.kind]}">
        <h3>${esc(d.headline)}</h3>
        ${renderDetail(d.detail)}
      </div>`
    )
    .join("");
}
