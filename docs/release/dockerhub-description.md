<!--
Canonical product description — single source of truth.

This file is the master copy for the long-form product description.
It is mirrored verbatim to:
  - Docker Hub long description (https://hub.docker.com/r/abrechen2/travstats)
  - Unraid Community Apps forum thread body (forums.unraid.net/topic/198320-...)
  - README.md "Why TravStats" section (with surrounding GitHub-flavoured layout)

When you edit the positioning here, also re-PATCH Docker Hub via API and
paste the body into the Unraid forum thread (forum has no API).

Docker Hub re-PATCH snippet (jwt env via ~/.docker-hub-pat):

    PAT=$(cat ~/.docker-hub-pat)
    JWT=$(curl -s -H "Content-Type: application/json" -X POST \
      -d "{\"username\":\"abrechen2\",\"password\":\"$PAT\"}" \
      https://hub.docker.com/v2/users/login/ \
      | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
    FULL=$(cat docs/release/dockerhub-description.md | python -c "import sys; print(sys.stdin.read().split('-->\n',1)[1].strip())")
    python -c "import json,urllib.request,os; \
      req=urllib.request.Request('https://hub.docker.com/v2/repositories/abrechen2/travstats/', \
      data=json.dumps({'full_description':'''$FULL'''}).encode(), \
      headers={'Authorization':'JWT $JWT','Content-Type':'application/json'},method='PATCH'); \
      print(urllib.request.urlopen(req).status)"
-->
Self-hosted travel logbook for small households and groups (1–10 users).

Log every flight you take (cruises landing in v2), visualise your routes on interactive 2D and

3D maps, collect 58 achievements, and import flights from boarding

passes (QR / PDF417 / OCR) and confirmation emails — all on your own

server, no cloud, no telemetry.

It's a logbook, not a live tracker — you record trips manually, scan a

boarding pass, or import a confirmation email, and TravStats turns them

into history, stats and maps.



--- Links ---

Project + issues: https://github.com/Abrechen2/TravStats

Container (primary): https://github.com/Abrechen2/TravStats/pkgs/container/travstats

Container (mirror): https://hub.docker.com/r/abrechen2/travstats

Templates repo: https://github.com/Abrechen2/docker-templates

Install guide w/ screenshots: https://github.com/Abrechen2/TravStats/blob/main/docs/unraid/README.md



--- Requirements ---

- Unraid 6.12 or 7.x

- amd64 host (arm64 not yet supported)

- ~250 MB RAM for the app, ~50 MB idle for Postgres

- ~500 MB disk + your flight data (a few MB per 1000 flights)

- Optional: a separate machine running Ollama for local LLM email

parsing — see "Optional local AI parsing" below.



--- Highlights ---

- Six map modes: Routes, Heatmap, Hexagon, 3D columns, animated Trips,

3D Globe with day/night terminator (deck.gl 9 + MapLibre 5).

- Year-over-year statistics across flights, distance, seats, classes,

routes, airlines, airports.

- Boarding-pass scanner: QR / PDF417 / OCR.

- Email + PDF import: plain text, HTML, Outlook .msg, .eml. Optional

local LLM parsing via Ollama for confirmation emails the regex

templates can't handle (gemma3:12b recommended; on a test corpus of

~30 mixed Lufthansa / BER / TUI emails it parsed every flight

correctly).

- Automated backups with retention + optional WebDAV off-site sync.

- 58 achievements across 5 categories.

- Security-hardened: JWT in HttpOnly cookies, rate limiting on every

auth and external-API endpoint, Zod input validation, Helmet CSP.

- German + English UI.

- In-app update banner — pings GitHub for new stable releases and

shows release notes; can be dismissed per version.



--- Installation ---

Two templates, install in this order.

1) travstats-db (PostGIS 15-3.4, host port 5432)

https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats-db.xml

Set a strong POSTGRES_PASSWORD (32+ random characters), Apply.

The app reaches the DB via host.docker.internal:5432, so no custom

Docker network is required.

2) TravStats (the app)

https://raw.githubusercontent.com/Abrechen2/docker-templates/main/travstats.xml

Replace the CHANGEME placeholder in the Database URL field with the

same password you just set, Apply. Click WebUI -> /setup -> create

admin account.



Updates: just hit the regular Update button on the Docker tab — the

container pulls the latest stable image from GHCR. The app shows a

yellow "Update" badge in the header when a new release is available.



--- Optional local AI parsing ---

Install the Ollama Community App, pull gemma3:12b (~7.5 GB), then in

TravStats: Admin -> Parser -> set Ollama URL to

http://<ollama-host>:11434. Handles multi-flight confirmation emails

that the built-in regex templates miss.



--- Coming next ---

- Cruise + multi-domain travel logbook (sea routes with realistic ship

paths, day/night animation on the globe).

- Future-flight lookup hardening — the lookup bug for past/future

dates that some of you reported is fixed in 1.2.1 (shipping this

week).



--- Bug reports & feature requests ---

- One-click "Report Bug" button in the top nav bundles anonymised

diagnostics + the last log lines.

- Or open an issue: https://github.com/Abrechen2/TravStats/issues/new/choose

Safe travels.
