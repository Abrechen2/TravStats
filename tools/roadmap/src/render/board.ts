import type { Card, Column } from "../model.js";
import { BACKLOG, type ItemStatus, UNASSIGNED } from "../types.js";
import { esc, renderLink } from "./escape.js";

const STATUS_LABEL: Record<ItemStatus, string> = {
  planned: "geplant",
  active: "aktiv",
  blocked: "blockiert",
  parked: "pausiert",
  "fixed-awaiting-release": "wartet auf Release",
  done: "erledigt",
};

const STATE_LABEL: Record<string, string> = {
  released: "veröffentlicht",
  rc: "RC",
  "awaiting-merge": "wartet auf Merge",
  planned: "geplant",
};

function versionLabel(column: Column): string {
  if (column.versionId === BACKLOG) return "Backlog";
  if (column.versionId === UNASSIGNED) return "Nicht zugeordnet";
  return column.versionId;
}

function stateLabel(column: Column): string {
  if (column.versionId === BACKLOG) return "Backlog";
  if (column.versionId === UNASSIGNED) return "Anti-Drift";
  return column.state !== null ? (STATE_LABEL[column.state] ?? column.state) : "—";
}

/**
 * Default-open: the current RC, any version awaiting a merge decision, and
 * the Unassigned anti-drift bucket — everything the owner needs to act on
 * right now. Default-closed: released versions and the backlog — history
 * and someday-work, read on demand rather than shown by default.
 */
function isDefaultOpen(column: Column): boolean {
  return (
    column.state === "rc" || column.state === "awaiting-merge" || column.versionId === UNASSIGNED
  );
}

function renderItemRow(card: Card): string {
  const ref = card.sourceRef !== null ? renderLink(card.url, `#${card.sourceRef}`) : "—";
  const closedBadge = card.closed ? ` <span class="badge green">geschlossen</span>` : "";
  const notes = card.notes !== null ? `<div class="notes">${esc(card.notes)}</div>` : "";
  const statusClass = card.status === "blocked" ? "red" : card.status === "done" ? "green" : "";

  return `<tr>
    <td>${ref}</td>
    <td>${esc(card.title)}${closedBadge}${notes}</td>
    <td class="${statusClass}">${esc(STATUS_LABEL[card.status])}</td>
    <td>${esc(card.source)}</td>
    <td>${card.branch !== null ? esc(card.branch) : "—"}</td>
  </tr>`;
}

function renderRow(column: Column): string {
  const blockedCount = column.cards.filter((c) => c.status === "blocked").length;
  const blockers = blockedCount > 0 ? `<span class="red">${blockedCount} blockiert</span>` : "—";
  const items =
    column.cards.length > 0
      ? `<table class="items">
          <thead><tr><th>Ref</th><th>Titel</th><th>Status</th><th>Quelle</th><th>Branch</th></tr></thead>
          <tbody>${column.cards.map(renderItemRow).join("")}</tbody>
        </table>`
      : `<p class="empty">Keine Items.</p>`;

  return `<details class="release-row"${isDefaultOpen(column) ? " open" : ""}>
    <summary>
      <span class="col-version">${esc(versionLabel(column))}</span>
      <span class="col-state">${esc(stateLabel(column))}</span>
      <span class="col-branch">${column.branch !== null ? esc(column.branch) : "—"}</span>
      <span class="col-items">${column.cards.length}</span>
      <span class="col-blockers">${blockers}</span>
    </summary>
    ${items}
  </details>`;
}

/** Replaces the old 7-column kanban board: releases are rows, not workflow columns. */
export function renderReleaseTable(columns: readonly Column[]): string {
  return `<div class="release-table">
    <div class="release-head">
      <span>Version</span><span>Status</span><span>Branch</span><span>Items</span><span>Blocker</span>
    </div>
    ${columns.map(renderRow).join("")}
  </div>`;
}
