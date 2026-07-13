import type { Card, Column, EffectiveStatus } from "../model.js";
import { BACKLOG, UNASSIGNED } from "../types.js";
import { esc, renderLink } from "./escape.js";

const STATUS_LABEL: Record<EffectiveStatus, string> = {
  planned: "geplant",
  active: "aktiv",
  blocked: "blockiert",
  parked: "pausiert",
  "fixed-awaiting-release": "wartet auf Release",
  done: "erledigt",
  shipped: "ausgeliefert",
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
 * Default-open: only what needs a decision right now — a version awaiting a
 * merge decision, and the Unassigned anti-drift bucket. Everything else
 * (released versions, the current RC, the backlog) starts collapsed with
 * its item count visible in the row header — a version with 18 items is a
 * wall of text no matter how tight the individual rows are, so it is read
 * on demand, not dumped by default.
 */
function isDefaultOpen(column: Column): boolean {
  return column.state === "awaiting-merge" || column.versionId === UNASSIGNED;
}

/** green for anything that shipped or is done, red for a blocker, muted otherwise. */
function statusClass(status: Card["status"]): string {
  if (status === "blocked") return "red";
  if (status === "done" || status === "shipped") return "green";
  return "";
}

/**
 * One line per item: Ref | Titel | Status | Quelle | Branch. The title is
 * clamped with an ellipsis so a long GitHub issue title cannot grow the row.
 * `notes` are the one field that used to flood the table with full
 * paragraphs — they now live behind their own per-item `<details>` toggle,
 * collapsed by default, so they stay reachable without being shown by
 * default.
 */
function renderItemRow(card: Card): string {
  const ref = card.sourceRef !== null ? renderLink(card.url, `#${card.sourceRef}`) : "—";
  const closedBadge = card.closed ? `<span class="badge green">geschlossen</span>` : "";
  const noteToggle =
    card.notes !== null
      ? `<details class="note-toggle"><summary>Notiz</summary><div class="notes">${esc(card.notes)}</div></details>`
      : "";

  return `<tr>
    <td>${ref}</td>
    <td class="item-title">
      <span class="title-text">${esc(card.title)}</span>${closedBadge}${noteToggle}
    </td>
    <td class="${statusClass(card.status)}">${esc(STATUS_LABEL[card.status])}</td>
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
