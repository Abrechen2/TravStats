# Unraid Forum — Support Thread

> **Where to post:** Unraid Forum → [Docker Engine](https://forums.unraid.net/forum/36-docker-engine/)
> (or Community Applications Support — a moderator will move it if needed).
>
> **Why:** Per the [Unraid CA submission FAQ](https://forums.unraid.net/topic/57181-docker-faq/),
> every CA template must have a dedicated Support thread. The `<Support>`
> field in the XML points at this thread's URL.
>
> **Forum formatting:** Unraid runs Invision Community, which accepts a
> mix of BBCode and a WYSIWYG editor. The body below uses BBCode so
> copy-paste works in the raw-source view of the editor (click the `<>`
> button in the toolbar to switch to source mode, paste, switch back).

---

## Thread title

```
[Support] TravStats — self-hosted flight tracker
```

---

## Thread body (paste in source-mode)

```bbcode
[img]https://raw.githubusercontent.com/Abrechen2/TravStats/main/docs/images/logo-large.png[/img]

[b]TravStats — self-hosted flight tracker[/b]

Track every flight, visualise routes on interactive 2D/3D maps, collect 58 achievements, import from boarding passes (QR / PDF417 / OCR) and confirmation emails — all on your own Unraid box. Built for 1–10 users.

[b]Links:[/b]
[list]
[*][b]Project:[/b] [url]https://github.com/Abrechen2/TravStats[/url]
[*][b]Container images:[/b] [url=https://hub.docker.com/r/abrechen2/travstats]Docker Hub[/url] · [url=https://github.com/Abrechen2/TravStats/pkgs/container/travstats]GHCR[/url]
[*][b]Templates repo:[/b] [url]https://github.com/Abrechen2/docker-templates[/url]
[*][b]Licence:[/b] AGPL-3.0-or-later
[/list]

[b]Highlights:[/b]
[list]
[*]Six map modes — Routes, Heatmap, Hexagon, 3D columns, animated Trips, 3D Globe (deck.gl 9 + MapLibre 5)
[*]Year-over-year statistics across flights, distance, seats, classes, routes
[*]Boarding-pass scanner — QR / PDF417 / OCR
[*]Email & PDF import — plain text, HTML, Outlook .msg, .eml, with optional local LLM parsing via Ollama (gemma3:12b recommended, 100% accuracy on my test corpus)
[*]Automated backups with retention + optional WebDAV off-site sync
[*]58 achievements across five categories
[*]22 pentest findings mitigated — JWT in HttpOnly cookies, 15 rate limiters, Zod validation everywhere, Helmet CSP
[*]German + English UI
[/list]

[b]Installation (two templates, install in this order):[/b]

1. [b]travstats-db[/b] — PostGIS 15-3.4, published on host port 5432
[code]https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml[/code]
Set a strong POSTGRES_PASSWORD (e.g. openssl rand -base64 32), Apply.

2. [b]TravStats[/b] — the app itself
[code]https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml[/code]
Replace the CHANGEME in the Database URL field with the same password, Apply. Click the WebUI button → /setup → create admin account.

The app reaches the DB via host.docker.internal:5432, so no custom Docker network is required.

Full install guide with screenshots: [url]https://github.com/Abrechen2/TravStats/blob/main/docs/unraid/README.md[/url]

[b]Optional local AI parsing:[/b] install the Ollama Community App, pull gemma3:12b (~7.5 GB), then in TravStats Admin → Parser set Ollama URL = http://<ollama-host>:11434. Handles multi-flight confirmation emails that the regex templates don't cover.

[b]Bug reports and feature requests welcome[/b] — here or on the [url=https://github.com/Abrechen2/TravStats/issues/new/choose]GitHub issue tracker[/url]. The app has a one-click "Report Bug" button in the top nav that bundles anonymised diagnostics + log tail.

Safe travels.
```

---

## After posting

1. Copy the thread URL from the browser (format: `https://forums.unraid.net/topic/NNNNNN-support-travstats/`).
2. Paste it into this README, then run a tiny helper to patch both XMLs in the `docker-templates` repo:

```bash
THREAD_URL="https://forums.unraid.net/topic/NNNNNN-support-travstats/"
cd /c/Users/DENNIS~1/AppData/Local/Temp/dt   # temp clone from earlier, or re-clone:
# git clone https://github.com/Abrechen2/docker-templates.git .
sed -i "s|<Support>.*</Support>|<Support>${THREAD_URL}</Support>|g" travstats.xml travstats-db.xml
git add travstats.xml travstats-db.xml
git commit -m "templates: point Support URL at the Unraid forum thread"
git push origin main
```

(Or send me the URL and I'll patch both XMLs in one go.)

## Asana submission form

Once the Support-URL is live in both XMLs:
[https://form.asana.com/?k=qtIUrf5ydiXvXzPI57BiJw&d=714739274360802](https://form.asana.com/?k=qtIUrf5ydiXvXzPI57BiJw&d=714739274360802)

Expected fields (confirm live on the form):
- **GitHub repo containing the XMLs**: `https://github.com/Abrechen2/docker-templates`
- **Template XML raw URLs**:
  - `https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml`
  - `https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml`
- **Developer handle (GitHub)**: `Abrechen2`
- **App names**: `TravStats`, `travstats-db`
- **Support URL**: forum thread URL from above
- **License**: `AGPL-3.0-or-later`
- **2FA on GitHub + Docker Hub**: confirm both are enabled — CA moderators flag this; if either is off, the submission is rejected.

## Timeline

- Moderator review: ~2 h for the quick-check
- Feed refresh: CA appfeed re-crawls every 2 h automatically after acceptance
- **Both apps must be searchable via the Apps tab within ~4–6 h** of approval. If not, ping the thread.
