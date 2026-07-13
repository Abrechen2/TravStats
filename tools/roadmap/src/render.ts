import type { Card, Column, ViewModel } from "./model.js";
import { STYLE } from "./style.js";

/** Discord content, issue titles, notes and branch names are user-supplied. They get escaped, always. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCard(card: Card): string {
  const link =
    card.url !== null
      ? `<a href="${esc(card.url)}">${card.sourceRef !== null ? `#${card.sourceRef}` : "link"}</a> `
      : "";
  const notes = card.notes !== null ? `<div class="notes">${esc(card.notes)}</div>` : "";

  return `<details class="card"><summary>${link}${esc(card.title)}
    <div class="badges">
      <span class="b ${esc(card.status)}">${esc(card.status)}</span>
      <span class="b">${esc(card.source)}</span>
      ${card.branch !== null ? `<span class="b">${esc(card.branch)}</span>` : ""}
    </div></summary>${notes}</details>`;
}

function renderColumn(column: Column): string {
  const state = column.state !== null ? ` · ${esc(column.state)}` : "";
  const note = column.note !== null ? `<p class="note">${esc(column.note)}</p>` : "";
  return `<div class="col">
    <h3><span>${esc(column.versionId)}${state}</span><span class="n">${column.cards.length}</span></h3>
    ${note}
    ${column.cards.map(renderCard).join("")}
  </div>`;
}

/** Pure renderer: no I/O, no clock, no randomness — the same ViewModel always produces the same HTML. */
export function render(vm: ViewModel): string {
  const decisions =
    vm.decisions.length > 0
      ? vm.decisions
          .map(
            (d) => `<div class="decision ${esc(d.kind)}">
              <h3>${esc(d.headline)}</h3>
              <ul>${d.detail.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
            </div>`
          )
          .join("")
      : `<p class="meta">Nichts zu entscheiden — kein fertiger Branch, keine wartenden Fixes, keine offene Triage.</p>`;

  const tiles = vm.instances
    .map(
      (i) => `<div class="tile ${i.mismatch || i.error !== null ? "bad" : ""}">
        <div class="v">${esc(i.running ?? "—")}</div>
        <div class="r">${esc(i.label)} · ${esc(i.role)}</div>
        ${i.mismatch ? `<div class="r">erwartet: ${esc(i.expected ?? "")}</div>` : ""}
        ${i.error !== null ? `<div class="r">${esc(i.error)}</div>` : ""}
      </div>`
    )
    .join("");

  const messages = vm.untriaged
    .map(
      (m) => `<div class="msg">
        <div class="h">#${esc(m.channel)} · ${esc(m.author)} · ${esc(m.timestamp)} · <a href="${esc(m.url)}">öffnen</a></div>
        <div class="c">${esc(m.content)}</div>
      </div>`
    )
    .join("");

  const branchRows = vm.branches
    .map(
      (b) => `<tr><td>${esc(b.name)}</td><td>${b.ahead}</td><td>${esc(b.worktree ?? "—")}</td></tr>`
    )
    .join("");

  const prRows = vm.dependabotPrs
    .map(
      (p) => `<tr><td><a href="${esc(p.url)}">#${p.number}</a></td><td>${esc(p.title)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>TravStats — Roadmap</title>
<style>${STYLE}</style></head>
<body>
  <h1>TravStats — Roadmap</h1>
  <div class="meta">Erzeugt: ${esc(vm.generatedAt)}</div>
  ${vm.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("")}

  <h2>Jetzt dran</h2>
  ${decisions}

  <h2>Instanzen</h2>
  <div class="tiles">${tiles}</div>

  <h2>Versionen</h2>
  <div class="board">${vm.columns.map(renderColumn).join("")}</div>

  ${vm.untriaged.length > 0 ? `<h2>Untriagiert (Discord)</h2>${messages}` : ""}

  <h2>Branches</h2>
  <table><thead><tr><th>Branch</th><th>ahead</th><th>Worktree</th></tr></thead><tbody>${branchRows}</tbody></table>

  ${vm.dependabotPrs.length > 0 ? `<h2>Dependabot</h2><table><tbody>${prRows}</tbody></table>` : ""}
</body></html>`;
}
