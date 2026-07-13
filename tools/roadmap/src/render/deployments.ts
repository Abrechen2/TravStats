import type { InstanceTile } from "../model.js";
import { esc } from "./escape.js";

interface MatrixRow {
  /** The running image tag, or null for the "unreachable" bucket. */
  readonly tag: string | null;
  readonly instances: readonly InstanceTile[];
}

/**
 * Version-first, not target-first: one row per distinct running tag, the
 * instances running it as the row's content. Forces the reader to compare
 * versions directly instead of scanning six separate boxes by hand.
 */
function buildMatrix(instances: readonly InstanceTile[]): readonly MatrixRow[] {
  const byTag = new Map<string | null, InstanceTile[]>();
  for (const instance of instances) {
    const bucket = byTag.get(instance.running) ?? [];
    bucket.push(instance);
    byTag.set(instance.running, bucket);
  }
  return [...byTag.entries()]
    .map(([tag, tiles]) => ({ tag, instances: tiles }))
    .sort((a, b) => {
      if (a.tag === null) return 1;
      if (b.tag === null) return -1;
      return b.tag.localeCompare(a.tag);
    });
}

function renderChip(instance: InstanceTile): string {
  const drift = instance.mismatch || instance.error !== null;
  const hint = instance.mismatch
    ? `<span class="hint">erwartet ${esc(instance.expected ?? "?")}</span>`
    : instance.error !== null
      ? `<span class="hint">${esc(instance.error)}</span>`
      : "";
  return `<span class="chip${drift ? " red" : ""}">${esc(instance.label)}${hint}</span>`;
}

export function renderDeploymentMatrix(instances: readonly InstanceTile[]): string {
  if (instances.length === 0) {
    return `<p class="empty">Keine Instanzen konfiguriert.</p>`;
  }
  const rows = buildMatrix(instances);
  return `<table class="matrix"><tbody>${rows
    .map(
      (row) => `<tr class="${row.tag === null ? "red" : ""}">
        <th>${row.tag !== null ? esc(row.tag) : "nicht erreichbar"}</th>
        <td>${row.instances.map(renderChip).join("")}</td>
      </tr>`
    )
    .join("")}</tbody></table>`;
}
