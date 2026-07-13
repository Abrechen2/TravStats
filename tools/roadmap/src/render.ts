import type { ViewModel } from "./model.js";
import { renderReleaseTable } from "./render/board.js";
import { renderDecisions } from "./render/decisions.js";
import { renderDeploymentMatrix } from "./render/deployments.js";
import { renderDiagnostics } from "./render/diagnostics.js";
import { renderDiscordDigest } from "./render/discord.js";
import { esc } from "./render/escape.js";
import { STYLE } from "./style.js";

/**
 * The page's one job: in five seconds, tell one reader what decision is
 * blocking what, and which version runs where. Everything else — the item
 * detail, the raw Discord transcript, branches, Dependabot — is drill-down,
 * collapsed behind `<details>` rather than flat in the default view.
 *
 * Pure renderer: no I/O, no clock, no randomness — the same ViewModel always
 * produces the same HTML.
 */
export function render(vm: ViewModel): string {
  const warnings = vm.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("");

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>TravStats — Roadmap</title>
<style>${STYLE}</style></head>
<body>
<main>
  <h1>TravStats — Roadmap</h1>
  <div class="meta">Erzeugt: ${esc(vm.generatedAt)}</div>
  ${warnings}

  <div class="top">
    <section class="decisions-zone">
      <h2>Entscheidungen</h2>
      ${renderDecisions(vm.decisions)}
    </section>
    <section class="deploy-zone">
      <h2>Wo läuft was</h2>
      ${renderDeploymentMatrix(vm.instances)}
    </section>
  </div>

  <section>
    <h2>Releases</h2>
    ${renderReleaseTable(vm.columns)}
  </section>

  <section>
    <h2>Discord</h2>
    ${renderDiscordDigest(vm.untriaged)}
  </section>

  ${renderDiagnostics(vm)}
</main>
</body></html>`;
}
