# TravStats - Community Apps Submission Checklist

Diese Checkliste musst du abarbeiten, bevor du TravStats bei Unraid Community Apps einreichen kannst.

## ðŸ“‹ Vor der Submission

### 1. Docker Image verÃ¶ffentlichen

- [ ] **GitHub Container Registry (GHCR) Setup:**
  ```bash
  # Login zu GHCR
  echo $CR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

  # Image bauen und pushen
  docker build -t ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest .
  docker push ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest

  # Version-Tag auch pushen
  docker tag ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest ghcr.io/YOUR_GITHUB_USERNAME/travstats:1.0.0
  docker push ghcr.io/YOUR_GITHUB_USERNAME/travstats:1.0.0
  ```

- [ ] **Image auf "Public" setzen:**
  - GitHub â†’ Packages â†’ travstats â†’ Settings â†’ Change visibility â†’ Public

### 2. Repository vorbereiten

- [ ] **README.md erstellen/aktualisieren:**
  - Features-Liste
  - Screenshots der UI
  - Installation-Anleitung
  - Unraid-spezifische Anweisungen

- [ ] **LICENSE Datei:**
  - AGPL-3.0 hinterlegen (liegt im Repo)
  - `LICENSE` Datei im Repo-Root

- [ ] **Logo/Icon erstellen:**
  - Format: PNG mit transparentem Hintergrund
  - GrÃ¶ÃŸe: Mindestens 256x256 px
  - Datei: `logo.png` im Repo-Root
  - Gut sichtbar in Hell- und Dunkelmodus

- [ ] **Alle Dateien committen:**
  ```bash
  git add .
  git commit -m "Prepare for Community Apps submission"
  git push origin main
  ```

### 3. Unraid Forum Support Thread erstellen

**WICHTIG:** Dies ist PFLICHT fÃ¼r Community Apps!

- [ ] **Forum-Account erstellen:**
  - https://forums.unraid.net/register/

- [ ] **Support Thread erstellen:**
  - Kategorie: **Docker Containers**
  - Titel: `[Support] TravStats - Flight Tracking Dashboard`
  - Inhalt sollte enthalten:
    - âœˆï¸ Beschreibung der App
    - ðŸ“¦ Installation-Anleitung (Link zu UNRAID_SETUP.md)
    - ðŸ”§ Troubleshooting-Tipps
    - ðŸ“¸ Screenshots
    - ðŸ”— GitHub Repository Link
    - ðŸ› Bekannte Issues
    - ðŸ“ Changelog

**Template fÃ¼r Forum-Post:**

```markdown
# TravStats - Personal Flight Tracking & Statistics Dashboard

Track your flights, visualize routes on an interactive map, and unlock achievements!

## Features
- ðŸ—ºï¸ Interactive world map with Leaflet
- âœˆï¸ Flight tracking with departure/arrival airports
- ðŸ† 58 Achievements (Battlefield-style)
- ðŸ“Š Advanced statistics & analytics
- ðŸŒ“ Dark mode support
- ðŸ“± Mobile-responsive UI

## Screenshots
[Add screenshots here]

## Installation

### Requirements
- Unraid 6.9+
- PostgreSQL with PostGIS (installed separately)

### Quick Start
1. Install PostgreSQL container (postgis/postgis:15-3.4)
2. Install TravStats from Community Apps
3. Configure database connection
4. Access WebUI and register

ðŸ“– **Detailed Guide:** https://github.com/YOUR_USERNAME/travstats/blob/main/UNRAID_SETUP.md

## Support
- ðŸ› Bug Reports: https://github.com/YOUR_USERNAME/travstats/issues
- ðŸ’¬ Questions: This thread
- ðŸ“š Documentation: https://github.com/YOUR_USERNAME/travstats

## Changelog
### v1.0.0 (2025-01-21)
- Initial release
```

- [ ] **Thread-URL notieren:**
  - Nach dem Erstellen: URL kopieren
  - Format: `https://forums.unraid.net/topic/XXXXX-support-travstats/`

### 4. XML Template finalisieren

- [ ] **unraid-template.xml anpassen:**
  ```xml
  <!-- Zeile 4: Dein Image Repository -->
  <Repository>ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest</Repository>

  <!-- Zeile 8: Forum Thread URL -->
  <Support>https://forums.unraid.net/topic/XXXXX-support-travstats/</Support>

  <!-- Zeile 9: GitHub Repository -->
  <Project>https://github.com/YOUR_GITHUB_USERNAME/travstats</Project>

  <!-- Zeile 36: Template URL -->
  <TemplateURL>https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/travstats/main/unraid-template.xml</TemplateURL>

  <!-- Zeile 37: Icon URL -->
  <Icon>https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/travstats/main/logo.png</Icon>
  ```

- [ ] **Template validieren:**
  - Stelle sicher, dass alle URLs erreichbar sind
  - Teste Raw-URLs im Browser

- [ ] **Template committen:**
  ```bash
  git add unraid-template.xml
  git commit -m "Update template with forum thread and final URLs"
  git push origin main
  ```

### 5. Lokaler Test

- [ ] **Template lokal testen:**
  - In Unraid: Docker â†’ Add Container
  - Template URL: `https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/travstats/main/unraid-template.xml`
  - ÃœberprÃ¼fe, ob alle Felder korrekt angezeigt werden

- [ ] **Installation durchfÃ¼hren:**
  - PostgreSQL Container installieren
  - TravStats Container installieren
  - FunktionalitÃ¤t testen
  - Logs prÃ¼fen

- [ ] **Screenshots erstellen:**
  - Dashboard
  - Karte mit FlÃ¼gen
  - Achievements-Seite
  - Statistiken
  - Dark Mode

## ðŸ“¤ Submission

### Option A: Offizieller CA-Templates Repository (Empfohlen)

- [ ] **Repository forken:**
  - https://github.com/Squidly271/docker-templates

- [ ] **Template hinzufÃ¼gen:**
  ```bash
  git clone https://github.com/YOUR_USERNAME/docker-templates
  cd docker-templates
  mkdir -p templates/YOUR_USERNAME
  cp /path/to/unraid-template.xml templates/YOUR_USERNAME/travstats.xml
  git add templates/YOUR_USERNAME/travstats.xml
  git commit -m "Add TravStats - Flight Tracking Dashboard"
  git push origin main
  ```

- [ ] **Pull Request erstellen:**
  - GitHub â†’ Original Repository â†’ New Pull Request
  - Title: `Add TravStats - Flight Tracking Dashboard`
  - Description:
    ```markdown
    # TravStats - Flight Tracking Dashboard

    Personal flight tracking application with achievements and statistics.

    ## Features
    - Interactive world map with flight visualization
    - 58 achievements system
    - Airport statistics
    - Dark mode support

    ## Links
    - Support Thread: https://forums.unraid.net/topic/XXXXX
    - GitHub: https://github.com/YOUR_USERNAME/travstats
    - Docker Image: ghcr.io/YOUR_USERNAME/travstats

    ## Testing
    Successfully tested on Unraid 6.12
    - PostgreSQL dependency documented
    - All environment variables validated
    - WebUI accessible and functional
    ```

- [ ] **Review abwarten:**
  - CA-Moderatoren prÃ¼fen das Template
  - Ggf. Anpassungen vornehmen
  - Approval abwarten

### Option B: Eigenes Template Repository (Schneller Start)

- [ ] **Template-URL verÃ¶ffentlichen:**
  - In README.md dokumentieren
  - In Forum-Thread posten

- [ ] **Nutzer-Anleitung:**
  ```markdown
  ## Manual Installation

  Until TravStats is approved in Community Apps, you can add it manually:

  1. Unraid â†’ Docker â†’ Add Container
  2. Template repositories: Add this URL:
     `https://raw.githubusercontent.com/YOUR_USERNAME/travstats/main/unraid-template.xml`
  3. Search for "TravStats" and install
  ```

## âœ… Finale Checkliste

### Vor dem Submit:
- [ ] Docker Image ist Ã¶ffentlich auf GHCR/Docker Hub
- [ ] GitHub Repository ist Ã¶ffentlich
- [ ] README.md ist vollstÃ¤ndig
- [ ] LICENSE Datei vorhanden
- [ ] logo.png (256x256+) vorhanden
- [ ] Unraid Forum Support Thread erstellt
- [ ] unraid-template.xml vollstÃ¤ndig ausgefÃ¼llt
- [ ] Alle URLs funktionieren (raw.githubusercontent.com testen!)
- [ ] Lokal auf Unraid getestet
- [ ] Screenshots vorhanden
- [ ] Documentation (UNRAID_SETUP.md) im Repo

### Template Requirements:
- [ ] Version 2 Container
- [ ] Support URL (Forum Thread)
- [ ] Project URL (GitHub)
- [ ] Overview mit klarer Beschreibung
- [ ] WebUI URL
- [ ] Icon (HTTPS)
- [ ] Alle Config-Entries haben: Name, Target, Type, Display, Required, Description
- [ ] Requires-Feld dokumentiert PostgreSQL
- [ ] Changes-Feld mit Changelog
- [ ] Category gesetzt

### Nach dem Submit:
- [ ] Pull Request verlinken im Forum-Thread
- [ ] Auf Review-Feedback reagieren
- [ ] Nach Approval: In Forum-Thread ankÃ¼ndigen
- [ ] GitHub Release erstellen (v1.0.0)

## ðŸ“ Wichtige Links

- **CA Templates Repo:** https://github.com/Squidly271/docker-templates
- **Unraid Forums:** https://forums.unraid.net/
- **Template Schema:** https://wiki.unraid.net/DockerTemplateSchema
- **GHCR Docs:** https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry

## ðŸŽ‰ Nach erfolgreicher Submission

Deine App ist jetzt im Community Apps Store!

**Marketing (optional):**
- [ ] Reddit Post in r/unRAID
- [ ] Twitter/X Announcement
- [ ] Self-Hosted Discord Communities
- [ ] Update README mit "Available in CA" Badge

**Maintenance:**
- [ ] GitHub Watch aktivieren fÃ¼r Issues
- [ ] Forum-Thread regelmÃ¤ÃŸig checken
- [ ] Updates zeitnah verÃ¶ffentlichen
- [ ] Security Patches prioritisieren

---

**Viel Erfolg! ðŸš€**
