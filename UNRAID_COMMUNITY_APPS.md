# TravStats - Unraid Community Apps Submission

Guide, um TravStats in die Unraid Community Apps zu bringen. Prod-Deployment zielt auf eine Community-App mit user-managed **PostGIS**-Datenbank (Pflicht) und optionalem Ollama-Container. Standard ist LAN-only; optional kann die App per Nginx Proxy Manager + Cloudflare veroeffentlicht werden.

---

## ÐYZî Voraussetzungen
- Öffentliches Docker Image (GHCR oder Docker Hub)
- XML-Template (`unraid-template.xml`)
- Öffentliches GitHub-Repository
- Icon/Logo (PNG, 256x256+)

---

## ÐY"Ý Schritt 1: Docker Image veroeffentlichen

### GHCR (empfohlen)
```bash
# Login
echo $CR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Build & Push
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest .
docker push ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest

# Version-Tag
docker tag ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest ghcr.io/YOUR_GITHUB_USERNAME/travstats:1.0.0
docker push ghcr.io/YOUR_GITHUB_USERNAME/travstats:1.0.0
```
Image auf "Public" stellen (GitHub → Packages → travstats → Settings → Change visibility).

### Docker Hub (Alternative)
```bash
docker login
docker build -t YOUR_DOCKERHUB_USERNAME/travstats:latest .
docker push YOUR_DOCKERHUB_USERNAME/travstats:latest
```

---

## ÐY-¬‹÷? Schritt 2: Icon
- PNG, 256x256+ (transparent empfohlen)
- Beispiel-URL: `https://raw.githubusercontent.com/YOUR_USERNAME/travstats/main/AppLogo.png`

---

## ÐY"? Schritt 3: XML-Template anpassen

Wichtige Felder in `unraid-template.xml`:
- `<Repository>`: dein Image (`ghcr.io/YOUR_USERNAME/travstats:latest`)
- `<Support>`: Support-Thread-URL (Unraid Forum)
- `<Project>`: GitHub-Repo
- `<TemplateURL>`: Raw-URL deines Templates
- `<Icon>`: Raw-URL deines Icons
- `<Requires>`: klar formulieren: **PostGIS** muss separat installiert werden; **Ollama optional** (nicht enthalten). Standard: LAN-only, optional Publish via NPM + Cloudflare.

Minimaler Auszug:
```xml
<Repository>ghcr.io/yourname/travstats:latest</Repository>
<Support>https://forums.unraid.net/topic/XXXXX-support-travstats</Support>
<Project>https://github.com/yourname/travstats</Project>
<TemplateURL>https://raw.githubusercontent.com/yourname/travstats/main/unraid-template.xml</TemplateURL>
<Icon>https://raw.githubusercontent.com/yourname/travstats/main/AppLogo.png</Icon>
<Requires>
  Requires external PostGIS (postgis/postgis) container; optional Ollama container if LLM parser is enabled.
  Default LAN-only; optional publish via Nginx Proxy Manager + Cloudflare.
</Requires>
```

---

## ÐYs? Schritt 4: Template & Repo vorbereiten
- `unraid-template.xml`, Icon und Doku (README, UNRAID_SETUP/INSTALL) committen.
- Hinweis in README/Docs: PostGIS Pflicht, Ollama optional, Standard LAN, optional Proxy/Cloudflare.
- Push auf `main`; Raw-URLs testen.

---

## ÐY"Ï Schritt 5: Support-Thread im Unraid Forum
- Kategorie: **Docker Containers**
- Titel: `[Support] TravStats - Flight Tracking Dashboard`
- Inhalt sollte enthalten:
  - Kurzbeschreibung + Featureliste
  - Installationshinweis: PostGIS separat, optional Ollama
  - Standard LAN, optional NPM + Cloudflare
  - Links: README, Template-URL, GitHub, Issues
  - Bekannte Issues/Changelog

Beispiel-Abschnitte (ohne Codebeispiele):
- Anforderungen: Unraid 6.9+, PostGIS (postgis/postgis), optional Ollama
- Quick Start: PostGIS installieren → TravStats installieren → `DATABASE_URL` setzen → Setup im LAN
- Extern: nur ueber Proxy/Tunnel mit TLS

Thread-URL fuer `<Support>` im Template verwenden.

---

## ÐY"Ï Schritt 6: Submission bei Community Apps

**Option A: Offizielles CA-Templates-Repo (empfohlen)**
1. Fork `https://github.com/Squidly271/docker-templates`
2. Template nach `templates/<deinname>/travstats.xml` kopieren
3. PR erstellen mit Beschreibung (Features, Links, PostGIS Pflicht, Ollama optional)

**Option B: Eigenes Template-Repo (bis Approval)**
1. Template-URL in Unraid unter "Add Template Repositories" hinzufuegen
2. Kommuniziere die URL im Forum-Thread/README

---

## ƒo. Checkliste vor Submission
- [ ] Docker Image public (latest + Version-Tag)
- [ ] unraid-template.xml mit korrekten URLs
- [ ] Requires-Feld nennt PostGIS-Pflicht + optionales Ollama, LAN-default, Proxy/Cloudflare optional
- [ ] Icon verfuegbar (HTTPS, 256x256+)
- [ ] README/UNRAID-Dokus betonen PostGIS, optional Ollama, LAN/Proxy-Hinweis
- [ ] Support-Thread im Unraid Forum erstellt (Link im Template)
- [ ] Installation auf Unraid lokal getestet (PostGIS + App + optional Ollama)

---

## ÐY"" GitHub Actions (optional)
Automatisches Build/Push nach GHCR:
```yaml
name: Build and Push Docker Image
on:
  push:
    branches: [ main ]
    tags: [ 'v*' ]
  pull_request:
    branches: [ main ]
env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

---

## ÐY"S Marketing (optional)
- Unraid Forum Post pflegen (Screenshots, Release Notes)
- Reddit r/unRAID, Self-Hosted Communities
- README mit Badges (CA verfügbar, Docker Pulls) aktualisieren, sobald live

---

## ÐY"s Support
- Issues: GitHub Issues
- Fragen: Unraid Support-Thread
- Doku: README + UNRAID_INSTALL.md / UNRAID_SETUP.md

---

Viel Erfolg bei der Submission! ÐYs?
