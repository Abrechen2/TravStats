# Unraid Forum — Support Thread

> **Where:** Unraid Forum → [Docker Engine](https://forums.unraid.net/forum/36-docker-engine/)
> (a moderator may move it to Community Apps Support later).
>
> **Editor:** Invision WYSIWYG — plain-text paste; use the toolbar to format
> (Bold via `B`, Lists via the `+` menu → "List", Links via `🔗`). URLs pasted
> on their own line get auto-linked. **Markdown / BBCode does NOT render.**
>
> **Source of truth:** the body below mirrors
> [`docs/release/dockerhub-description.md`](./dockerhub-description.md). Keep
> the two in sync — if you edit one, edit the other (and re-PATCH Docker Hub).

---

## Thread title (paste into the Title field)

```
[Support] TravStats — self-hosted travel logbook (flights, cruises, more)
```

---

## Body (paste into the editor, then format as described after)

```text
TravStats is a self-hosted travel logbook for small households and groups (1–10 users). Log every flight you take (cruises landing in v2), visualise your routes on interactive 2D and 3D maps, collect 58 achievements, and import flights from boarding passes (QR / PDF417 / OCR) and confirmation emails — all on your own Unraid box, no cloud, no telemetry.

It's a logbook, not a live tracker — you record trips manually, scan a boarding pass, or import a confirmation email, and TravStats turns them into history, stats and maps.


Links

Project + issues: https://github.com/Abrechen2/TravStats
Container (primary): https://github.com/Abrechen2/TravStats/pkgs/container/travstats
Container (mirror): https://hub.docker.com/r/abrechen2/travstats
Templates repo: https://github.com/Abrechen2/docker-templates
Install guide w/ screenshots: https://github.com/Abrechen2/TravStats/blob/main/docs/unraid/README.md


Requirements

- Unraid 6.12 or 7.x
- amd64 host (arm64 not yet supported)
- ~250 MB RAM for the app, ~50 MB idle for Postgres
- ~500 MB disk + your flight data (a few MB per 1000 flights)
- Optional: a separate machine running Ollama for local LLM email parsing — see "Optional local AI parsing" below.


Highlights

- Six map modes: Routes, Heatmap, Hexagon, 3D columns, animated Trips, 3D Globe with day/night terminator (deck.gl 9 + MapLibre 5).
- Year-over-year statistics across flights, distance, seats, classes, routes, airlines, airports.
- Boarding-pass scanner: QR / PDF417 / OCR.
- Email + PDF import: plain text, HTML, Outlook .msg, .eml. Optional local LLM parsing via Ollama for confirmation emails the regex templates can't handle (gemma3:12b recommended; on a test corpus of ~30 mixed Lufthansa / BER / TUI emails it parsed every flight correctly).
- Automated backups with retention + optional WebDAV off-site sync.
- 58 achievements across 5 categories.
- Security-hardened: JWT in HttpOnly cookies, rate limiting on every auth and external-API endpoint, Zod input validation, Helmet CSP.
- German + English UI.
- In-app update banner — pings GitHub for new stable releases and shows release notes; can be dismissed per version.


Installation

Two templates, install in this order.

1) travstats-db (PostGIS 15-3.4, host port 5432)
https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml
Set a strong POSTGRES_PASSWORD (32+ random characters), Apply. The app reaches the DB via host.docker.internal:5432, so no custom Docker network is required.

2) TravStats (the app)
https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml
Replace the CHANGEME placeholder in the Database URL field with the same password you just set, Apply. Click the WebUI button → /setup → create admin account.

Updates: just hit the regular Update button on the Docker tab — the container pulls the latest stable image from GHCR. The app shows a yellow "Update" badge in the header when a new release is available.


Optional local AI parsing

Install the Ollama Community App, pull gemma3:12b (~7.5 GB), then in TravStats: Admin → Parser → set Ollama URL to http://<ollama-host>:11434. Handles multi-flight confirmation emails that the built-in regex templates miss.


Image tags

abrechen2/travstats:latest — current stable (auto-updates on each promoted release). Default for the template above.
abrechen2/travstats:stable — alias for :latest.
abrechen2/travstats:1.2.1 (or any prior X.Y.Z) — pin to one specific release, never auto-updates.
abrechen2/travstats:rc-latest — bleeding-edge Release Candidate. Receives every new RC via Force Update. May include breaking schema migrations across majors; in-place backup runs automatically on the first start of a new major. Use only if you want to help test before a release goes stable.

Both Docker Hub and GHCR (ghcr.io/abrechen2/travstats) carry the same digests for these moving tags.


Coming next

- Cruise + multi-domain travel logbook (sea routes with realistic ship paths, day/night animation on the globe).
- Future-flight lookup hardening — the lookup bug for past/future dates that some of you reported is fixed in 1.2.1 (shipping this week).


Bug reports & feature requests

- One-click "Report Bug" button in the top nav bundles anonymised diagnostics + the last log lines.
- Or open an issue: https://github.com/Abrechen2/TravStats/issues/new/choose

Safe travels.
```

---

## Formatting in the WYSIWYG after paste

1. Put the cursor on the section headings ("Links", "Requirements", "Highlights", "Installation", "Optional local AI parsing", "Image tags", "Coming next", "Bug reports & feature requests") and click `B` (bold) — that's the only formatting you need.
2. The URLs that stand alone on a line auto-link on save.
3. Optional: drag `docs/images/logo.svg` (from the GitHub raw URL or your local copy) into the editor as the first element — it uploads inline. If the forum rejects SVG, export a PNG from the same file first.
4. Optional: drag one of the screenshots (`map-2d.png` or `stats.png`) in after the Highlights section so the thread has a visual.

If you prefer to paste HTML directly: click `…` in the toolbar to look for a "Source" or "</>" option. If it's there, paste this HTML instead of the plain text above:

```html
<p><strong>TravStats</strong> is a self-hosted travel logbook for small households and groups (1–10 users). Log every flight you take (cruises landing in v2), visualise your routes on interactive 2D and 3D maps, collect 58 achievements, and import flights from boarding passes (QR / PDF417 / OCR) and confirmation emails — all on your own Unraid box, no cloud, no telemetry.</p>
<p>It's a logbook, not a live tracker — you record trips manually, scan a boarding pass, or import a confirmation email, and TravStats turns them into history, stats and maps.</p>
<h3>Links</h3>
<ul>
  <li><strong>Project + issues:</strong> <a href="https://github.com/Abrechen2/TravStats">github.com/Abrechen2/TravStats</a></li>
  <li><strong>Container (primary):</strong> <a href="https://github.com/Abrechen2/TravStats/pkgs/container/travstats">GHCR</a></li>
  <li><strong>Container (mirror):</strong> <a href="https://hub.docker.com/r/abrechen2/travstats">Docker Hub</a></li>
  <li><strong>Templates repo:</strong> <a href="https://github.com/Abrechen2/docker-templates">github.com/Abrechen2/docker-templates</a></li>
  <li><strong>Install guide w/ screenshots:</strong> <a href="https://github.com/Abrechen2/TravStats/blob/main/docs/unraid/README.md">docs/unraid/README.md</a></li>
</ul>
<h3>Requirements</h3>
<ul>
  <li>Unraid 6.12 or 7.x</li>
  <li>amd64 host (arm64 not yet supported)</li>
  <li>~250 MB RAM for the app, ~50 MB idle for Postgres</li>
  <li>~500 MB disk + your flight data (a few MB per 1000 flights)</li>
  <li>Optional: a separate machine running Ollama for local LLM email parsing — see "Optional local AI parsing" below.</li>
</ul>
<h3>Highlights</h3>
<ul>
  <li>Six map modes: Routes, Heatmap, Hexagon, 3D columns, animated Trips, 3D Globe with day/night terminator (deck.gl 9 + MapLibre 5).</li>
  <li>Year-over-year statistics across flights, distance, seats, classes, routes, airlines, airports.</li>
  <li>Boarding-pass scanner: QR / PDF417 / OCR.</li>
  <li>Email + PDF import: plain text, HTML, Outlook .msg, .eml. Optional local LLM parsing via Ollama for confirmation emails the regex templates can't handle (<code>gemma3:12b</code> recommended; on a test corpus of ~30 mixed Lufthansa / BER / TUI emails it parsed every flight correctly).</li>
  <li>Automated backups with retention + optional WebDAV off-site sync.</li>
  <li>58 achievements across 5 categories.</li>
  <li>Security-hardened: JWT in HttpOnly cookies, rate limiting on every auth and external-API endpoint, Zod input validation, Helmet CSP.</li>
  <li>German + English UI.</li>
  <li>In-app update banner — pings GitHub for new stable releases and shows release notes; can be dismissed per version.</li>
</ul>
<h3>Installation</h3>
<p>Two templates, install in this order.</p>
<p><strong>1) travstats-db</strong> (PostGIS 15-3.4, host port 5432)</p>
<pre>https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml</pre>
<p>Set a strong <code>POSTGRES_PASSWORD</code> (32+ random characters), Apply. The app reaches the DB via <code>host.docker.internal:5432</code>, so no custom Docker network is required.</p>
<p><strong>2) TravStats</strong> (the app)</p>
<pre>https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml</pre>
<p>Replace the <code>CHANGEME</code> placeholder in the Database URL field with the same password you just set, Apply. Click the WebUI button → <code>/setup</code> → create admin account.</p>
<p>Updates: just hit the regular Update button on the Docker tab — the container pulls the latest stable image from GHCR. The app shows a yellow "Update" badge in the header when a new release is available.</p>
<h3>Optional local AI parsing</h3>
<p>Install the Ollama Community App, pull <code>gemma3:12b</code> (~7.5 GB), then in TravStats <strong>Admin → Parser</strong> set <em>Ollama URL</em> to <code>http://&lt;ollama-host&gt;:11434</code>. Handles multi-flight confirmation emails that the built-in regex templates miss.</p>
<h3>Image tags</h3>
<ul>
  <li><code>abrechen2/travstats:latest</code> — current stable (auto-updates on each promoted release). Default for the template above.</li>
  <li><code>abrechen2/travstats:stable</code> — alias for <code>:latest</code>.</li>
  <li><code>abrechen2/travstats:1.2.1</code> (or any prior <code>X.Y.Z</code>) — pin to one specific release, never auto-updates.</li>
  <li><code>abrechen2/travstats:rc-latest</code> — bleeding-edge Release Candidate. Receives every new RC via Force Update. May include breaking schema migrations across majors; in-place backup runs automatically on the first start of a new major. Use only if you want to help test before a release goes stable.</li>
</ul>
<p>Both Docker Hub and GHCR (<code>ghcr.io/abrechen2/travstats</code>) carry the same digests for these moving tags.</p>
<h3>Coming next</h3>
<ul>
  <li>Cruise + multi-domain travel logbook (sea routes with realistic ship paths, day/night animation on the globe).</li>
  <li>Future-flight lookup hardening — the lookup bug for past/future dates that some of you reported is fixed in 1.2.1 (shipping this week).</li>
</ul>
<h3>Bug reports &amp; feature requests</h3>
<ul>
  <li>One-click "Report Bug" button in the top nav bundles anonymised diagnostics + the last log lines.</li>
  <li>Or open an issue: <a href="https://github.com/Abrechen2/TravStats/issues/new/choose">github.com/Abrechen2/TravStats/issues</a></li>
</ul>
<p>Safe travels.</p>
```

---

## After posting

Copy the thread URL (format: `https://forums.unraid.net/topic/NNNNNN-support-travstats/`) and send it to me. I'll patch both XMLs in `docker-templates` in one push:

```xml
<Support>https://forums.unraid.net/topic/NNNNNN-support-travstats/</Support>
```

## Asana submission form

Once Support URL is live in both XMLs:
https://form.asana.com/?k=qtIUrf5ydiXvXzPI57BiJw&d=714739274360802

Expected fields:
- **GitHub repo with the XMLs:** `https://github.com/Abrechen2/docker-templates`
- **XML raw URLs:**
  - `https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml`
  - `https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml`
- **GitHub handle:** `Abrechen2`
- **App names:** `TravStats`, `travstats-db`
- **Support URL:** forum thread URL
- **License:** `AGPL-3.0-or-later`
- **2FA on GitHub + Docker Hub:** confirmed. **Check before submitting** — if either is off, moderators reject immediately.

## Timeline

- Moderator review: ~2 h
- CA appfeed refresh: every 2 h after approval
- Both apps searchable via the **Apps** tab within 4–6 h of approval
