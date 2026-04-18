# Unraid Forum — Support Thread

> **Where:** Unraid Forum → [Docker Engine](https://forums.unraid.net/forum/36-docker-engine/)
> (a moderator may move it to Community Apps Support later).
>
> **Editor:** Invision WYSIWYG — plain-text paste; use the toolbar to format
> (Bold via `B`, Lists via the `+` menu → "List", Links via `🔗`). URLs pasted
> on their own line get auto-linked. **Markdown / BBCode does NOT render.**

---

## Thread title (paste into the Title field)

```
[Support] TravStats — self-hosted flight tracker
```

---

## Body (paste into the editor, then format as described after)

```text
TravStats is a self-hosted flight tracker for small households and groups (1–10 users). Track every flight, visualise routes on interactive 2D/3D maps, collect 58 achievements, import from boarding passes (QR / PDF417 / OCR) and confirmation emails — all on your own Unraid box.


Links

Project: https://github.com/Abrechen2/TravStats
Container images: https://hub.docker.com/r/abrechen2/travstats (Docker Hub) · https://github.com/Abrechen2/TravStats/pkgs/container/travstats (GHCR)
Templates repo: https://github.com/Abrechen2/docker-templates
Licence: AGPL-3.0-or-later


Highlights

Six map modes — Routes, Heatmap, Hexagon, 3D columns, animated Trips, 3D Globe (deck.gl 9 + MapLibre 5)
Year-over-year statistics across flights, distance, seats, classes, routes
Boarding-pass scanner — QR / PDF417 / OCR
Email and PDF import — plain text, HTML, Outlook .msg, .eml, with optional local LLM parsing via Ollama (gemma3:12b recommended, 100% accuracy on my test corpus)
Automated backups with retention + optional WebDAV off-site sync
58 achievements across five categories
22 pentest findings mitigated — JWT in HttpOnly cookies, 15 rate limiters, Zod validation everywhere, Helmet CSP
German + English UI


Installation

Two templates, install in this order.

1) travstats-db — PostGIS 15-3.4, published on host port 5432

https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml

Set a strong POSTGRES_PASSWORD (e.g. openssl rand -base64 32), Apply.

2) TravStats — the app itself

https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml

Replace the CHANGEME in the Database URL field with the same password, Apply. Click the WebUI button → /setup → create admin account.

The app reaches the DB via host.docker.internal:5432, so no custom Docker network is required.

Full install guide with screenshots: https://github.com/Abrechen2/TravStats/blob/main/docs/unraid/README.md


Optional local AI parsing

Install the Ollama Community App, pull gemma3:12b (~7.5 GB), then in TravStats Admin → Parser set Ollama URL to http://<ollama-host>:11434. Handles multi-flight confirmation emails that the regex templates don't cover.


Bug reports and feature requests welcome — here or on the GitHub issue tracker: https://github.com/Abrechen2/TravStats/issues/new/choose

The app has a one-click "Report Bug" button in the top nav that bundles anonymised diagnostics + log tail.

Safe travels.
```

---

## Formatting in the WYSIWYG after paste

1. Put the cursor on the section headings ("Links", "Highlights", "Installation", "Optional local AI parsing") and click `B` (bold) — that's the only formatting you need.
2. The URLs that stand alone on a line auto-link on save.
3. Optional: drag `docs/images/logo.svg` (from the GitHub raw URL or your local copy) into the editor as the first element — it uploads inline. If the forum rejects SVG, export a PNG from the same file first.
4. Optional: drag one of the screenshots (`map-2d.png` or `stats.png`) in after the Highlights section so the thread has a visual.

If you prefer to paste HTML directly: click `…` in the toolbar to look for a "Source" or "</>" option. If it's there, paste this HTML instead of the plain text above:

```html
<p><strong>TravStats</strong> is a self-hosted flight tracker for small households and groups (1–10 users). Track every flight, visualise routes on interactive 2D/3D maps, collect 58 achievements, import from boarding passes (QR / PDF417 / OCR) and confirmation emails — all on your own Unraid box.</p>
<h3>Links</h3>
<ul>
  <li><strong>Project:</strong> <a href="https://github.com/Abrechen2/TravStats">github.com/Abrechen2/TravStats</a></li>
  <li><strong>Container images:</strong> <a href="https://hub.docker.com/r/abrechen2/travstats">Docker Hub</a> · <a href="https://github.com/Abrechen2/TravStats/pkgs/container/travstats">GHCR</a></li>
  <li><strong>Templates repo:</strong> <a href="https://github.com/Abrechen2/docker-templates">github.com/Abrechen2/docker-templates</a></li>
  <li><strong>Licence:</strong> AGPL-3.0-or-later</li>
</ul>
<h3>Highlights</h3>
<ul>
  <li>Six map modes — Routes, Heatmap, Hexagon, 3D columns, animated Trips, 3D Globe (deck.gl 9 + MapLibre 5)</li>
  <li>Year-over-year statistics across flights, distance, seats, classes, routes</li>
  <li>Boarding-pass scanner — QR / PDF417 / OCR</li>
  <li>Email and PDF import — plain text, HTML, Outlook .msg, .eml, with optional local LLM parsing via Ollama (gemma3:12b recommended, 100% accuracy on my test corpus)</li>
  <li>Automated backups with retention + optional WebDAV off-site sync</li>
  <li>58 achievements across five categories</li>
  <li>22 pentest findings mitigated — JWT in HttpOnly cookies, 15 rate limiters, Zod validation everywhere, Helmet CSP</li>
  <li>German + English UI</li>
</ul>
<h3>Installation</h3>
<p>Two templates, install in this order.</p>
<p><strong>1) travstats-db</strong> — PostGIS 15-3.4, published on host port 5432</p>
<pre>https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml</pre>
<p>Set a strong <code>POSTGRES_PASSWORD</code> (e.g. <code>openssl rand -base64 32</code>), Apply.</p>
<p><strong>2) TravStats</strong> — the app itself</p>
<pre>https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml</pre>
<p>Replace the <code>CHANGEME</code> in the Database URL field with the same password, Apply. Click the WebUI button → <code>/setup</code> → create admin account.</p>
<p>The app reaches the DB via <code>host.docker.internal:5432</code>, so no custom Docker network is required.</p>
<p>Full install guide with screenshots: <a href="https://github.com/Abrechen2/TravStats/blob/main/docs/unraid/README.md">docs/unraid/README.md</a></p>
<h3>Optional local AI parsing</h3>
<p>Install the Ollama Community App, pull <code>gemma3:12b</code> (~7.5 GB), then in TravStats <strong>Admin → Parser</strong> set <em>Ollama URL</em> to <code>http://&lt;ollama-host&gt;:11434</code>. Handles multi-flight confirmation emails that the regex templates don't cover.</p>
<p>Bug reports and feature requests welcome — here or on the <a href="https://github.com/Abrechen2/TravStats/issues/new/choose">GitHub issue tracker</a>. The app has a one-click "Report Bug" button in the top nav that bundles anonymised diagnostics + log tail.</p>
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
