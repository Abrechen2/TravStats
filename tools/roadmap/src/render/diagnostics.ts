import type { ViewModel } from "../model.js";
import { esc, renderLink } from "./escape.js";

/**
 * Everything here is real information the tool must never lose, but none of
 * it helps answer "what's blocking what" in five seconds — version notes,
 * worktree paths and the Dependabot list are collapsed diagnostics, read on
 * demand rather than shown by default.
 */
export function renderDiagnostics(vm: ViewModel): string {
  const noteRows = vm.columns
    .filter((c) => c.note !== null)
    .map((c) => `<li><strong>${esc(c.versionId)}:</strong> ${esc(c.note ?? "")}</li>`)
    .join("");

  const branchRows = vm.branches
    .map(
      (b) =>
        `<tr><td>${esc(b.name)}</td><td>${esc(b.head)}</td><td>${b.ahead}</td><td>${esc(b.worktree ?? "—")}</td></tr>`
    )
    .join("");

  const prRows = vm.dependabotPrs
    .map((p) => `<tr><td>${renderLink(p.url, `#${p.number}`)}</td><td>${esc(p.title)}</td></tr>`)
    .join("");

  return `<details class="diagnostics">
    <summary>Diagnose</summary>
    ${noteRows.length > 0 ? `<h3>Versionsnotizen</h3><ul>${noteRows}</ul>` : ""}
    <h3>Branches</h3>
    <table><thead><tr><th>Branch</th><th>Commit</th><th>ahead</th><th>Worktree</th></tr></thead>
      <tbody>${branchRows}</tbody></table>
    ${
      vm.dependabotPrs.length > 0
        ? `<h3>Dependabot</h3><table><tbody>${prRows}</tbody></table>`
        : ""
    }
  </details>`;
}
