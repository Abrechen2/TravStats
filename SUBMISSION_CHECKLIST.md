# TravStats - Community Apps Submission Checklist

Pflichtpunkte vor der Einreichung bei Unraid Community Apps. Prod-Deployment setzt auf user-managed **PostGIS** (Pflicht) und optionales Ollama; App standardmaessig im LAN, optional via Nginx Proxy Manager + Cloudflare veroeffentlichbar.

---

## ÐY"< Vor der Submission

### 1) Docker Image public machen
```bash
echo $CR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest .
docker push ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest
docker tag ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest ghcr.io/YOUR_GITHUB_USERNAME/travstats:1.0.0
docker push ghcr.io/YOUR_GITHUB_USERNAME/travstats:1.0.0
```
- Sichtbarkeit: Package auf "Public" stellen.

### 2) Repository vorbereiten
- README/Doku: PostGIS-Pflicht, Ollama optional, Standard LAN, optional Proxy/Cloudflare.
- LICENSE im Repo (AGPL-3.0).
- Icon `AppLogo.png` o.ä. (PNG, 256x256+).
- Dokus: `UNRAID_INSTALL.md`, `UNRAID_SETUP.md`, `UNRAID_COMMUNITY_APPS.md` aktuell.

### 3) Support-Thread im Unraid Forum
- Kategorie: Docker Containers, Titel `[Support] TravStats - Flight Tracking Dashboard`.
- Inhalt: Features, Install (PostGIS + optional Ollama), LAN-Default, optional NPM+Cloudflare, Links (README, Template, GitHub, Issues), bekannte Issues.
- Thread-URL merken fuer `<Support>` im Template.

### 4) Template finalisieren (`unraid-template.xml`)
- `<Repository>` auf dein Image, `<Support>` auf Forum-Thread, `<Project>` GitHub.
- `<TemplateURL>` und `<Icon>` auf Raw-URLs.
- `<Requires>` enthaelt: PostGIS separat, optional Ollama, Standard LAN, optional Publish via Proxy/Cloudflare.
- Validieren, dass alle URLs erreichbar sind (raw.githubusercontent.com).

### 5) Lokaler Test auf Unraid
- PostGIS Container starten, TravStats Template nutzen, optional Ollama.
- Setup im LAN durchlaufen, Datenbank/Healthcheck pruefen, Logs ohne Errors.
- Screenshots fuer Forum/README machen.

---

## ÐY"Ï Submission

### Option A: Offizielles CA-Templates-Repo
- Fork `https://github.com/Squidly271/docker-templates`.
- Template nach `templates/<deinname>/travstats.xml`.
- PR mit Beschreibung (Features, PostGIS-Pflicht, optionales Ollama, Links, Testnotizen).

### Option B: Eigenes Template-Repo (bis Approval)
- Template-URL in Unraid unter "Add Template Repositories" bereitstellen.
- URL im Forum-Thread/README kommunizieren.

---

## ƒo. Finale Checkliste
- [ ] Docker Image public (latest + Version)
- [ ] unraid-template.xml mit richtigen URLs und Requires (PostGIS Pflicht, optionales Ollama, LAN-Default/Proxy-Hinweis)
- [ ] Icon (PNG, 256x256+) per HTTPS erreichbar
- [ ] README/Unraid-Dokus aktualisiert (PostGIS/Ollama/LAN/Proxy)
- [ ] Support-Thread erstellt, Link im Template
- [ ] Installation auf Unraid erfolgreich getestet
- [ ] Raw-Links fuer Template/Icon funktionieren

---

Viel Erfolg bei der Einreichung! ÐYs?
