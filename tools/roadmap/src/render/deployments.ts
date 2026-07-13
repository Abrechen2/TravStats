import type { InstanceTile } from "../model.js";
import { esc } from "./escape.js";

/**
 * Target-first: one row per server, in the order the config declares them, with
 * the tag it actually runs behind it. The owner reads this as "which of my boxes
 * is on what", so the box is the anchor and the version is the answer — not the
 * other way round.
 */
function renderRow(instance: InstanceTile): string {
  const drift = instance.mismatch || instance.error !== null;
  const version =
    instance.running !== null ? esc(instance.running) : "<span>nicht erreichbar</span>";
  const hint = instance.mismatch
    ? `<span class="hint">erwartet ${esc(instance.expected ?? "?")}</span>`
    : instance.error !== null
      ? `<span class="hint">${esc(instance.error)}</span>`
      : "";

  return `<tr class="${drift ? "red" : ""}">
    <th>${esc(instance.label)}</th>
    <td><span class="tag${drift ? " red" : ""}">${version}</span>${hint}</td>
  </tr>`;
}

export function renderDeploymentMatrix(instances: readonly InstanceTile[]): string {
  if (instances.length === 0) {
    return `<p class="empty">Keine Instanzen konfiguriert.</p>`;
  }
  return `<table class="matrix"><tbody>${instances.map(renderRow).join("")}</tbody></table>`;
}
