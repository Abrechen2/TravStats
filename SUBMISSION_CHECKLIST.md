# TravStats - Community Apps Submission Checklist

Diese Checkliste musst du abarbeiten, bevor du TravStats bei Unraid Community Apps einreichen kannst.

## 📋 Vor der Submission

### 1. Docker Image veröffentlichen

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
  - GitHub → Packages → travstats → Settings → Change visibility → Public

### 2. Repository vorbereiten

- [ ] **README.md erstellen/aktualisieren:**
  - Features-Liste
  - Screenshots der UI
  - Installation-Anleitung
  - Unraid-spezifische Anweisungen

- [ ] **LICENSE Datei:**
  - Füge eine Lizenz hinzu (z.B. MIT)
  - `LICENSE` Datei im Repo-Root

- [ ] **Logo/Icon erstellen:**
  - Format: PNG mit transparentem Hintergrund
  - Größe: Mindestens 256x256 px
  - Datei: `logo.png` im Repo-Root
  - Gut sichtbar in Hell- und Dunkelmodus

- [ ] **Alle Dateien committen:**
  ```bash
  git add .
  git commit -m "Prepare for Community Apps submission"
  git push origin main
  ```

### 3. Unraid Forum Support Thread erstellen

**WICHTIG:** Dies ist PFLICHT für Community Apps!

- [ ] **Forum-Account erstellen:**
  - https://forums.unraid.net/register/

- [ ] **Support Thread erstellen:**
  - Kategorie: **Docker Containers**
  - Titel: `[Support] TravStats - Flight Tracking Dashboard`
  - Inhalt sollte enthalten:
    - ✈️ Beschreibung der App
    - 📦 Installation-Anleitung (Link zu UNRAID_SETUP.md)
    - 🔧 Troubleshooting-Tipps
    - 📸 Screenshots
    - 🔗 GitHub Repository Link
    - 🐛 Bekannte Issues
    - 📝 Changelog

**Template für Forum-Post:**

```markdown
# TravStats - Personal Flight Tracking & Statistics Dashboard

Track your flights, visualize routes on an interactive map, and unlock achievements!

## Features
- 🗺️ Interactive world map with Leaflet
- ✈️ Flight tracking with departure/arrival airports
- 🏆 58 Achievements (Battlefield-style)
- 📊 Advanced statistics & analytics
- 🌓 Dark mode support
- 📱 Mobile-responsive UI

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

📖 **Detailed Guide:** https://github.com/YOUR_USERNAME/travstats/blob/main/UNRAID_SETUP.md

## Support
- 🐛 Bug Reports: https://github.com/YOUR_USERNAME/travstats/issues
- 💬 Questions: This thread
- 📚 Documentation: https://github.com/YOUR_USERNAME/travstats

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
  - In Unraid: Docker → Add Container
  - Template URL: `https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/travstats/main/unraid-template.xml`
  - Überprüfe, ob alle Felder korrekt angezeigt werden

- [ ] **Installation durchführen:**
  - PostgreSQL Container installieren
  - TravStats Container installieren
  - Funktionalität testen
  - Logs prüfen

- [ ] **Screenshots erstellen:**
  - Dashboard
  - Karte mit Flügen
  - Achievements-Seite
  - Statistiken
  - Dark Mode

## 📤 Submission

### Option A: Offizieller CA-Templates Repository (Empfohlen)

- [ ] **Repository forken:**
  - https://github.com/Squidly271/docker-templates

- [ ] **Template hinzufügen:**
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
  - GitHub → Original Repository → New Pull Request
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
  - CA-Moderatoren prüfen das Template
  - Ggf. Anpassungen vornehmen
  - Approval abwarten

### Option B: Eigenes Template Repository (Schneller Start)

- [ ] **Template-URL veröffentlichen:**
  - In README.md dokumentieren
  - In Forum-Thread posten

- [ ] **Nutzer-Anleitung:**
  ```markdown
  ## Manual Installation

  Until TravStats is approved in Community Apps, you can add it manually:

  1. Unraid → Docker → Add Container
  2. Template repositories: Add this URL:
     `https://raw.githubusercontent.com/YOUR_USERNAME/travstats/main/unraid-template.xml`
  3. Search for "TravStats" and install
  ```

## ✅ Finale Checkliste

### Vor dem Submit:
- [ ] Docker Image ist öffentlich auf GHCR/Docker Hub
- [ ] GitHub Repository ist öffentlich
- [ ] README.md ist vollständig
- [ ] LICENSE Datei vorhanden
- [ ] logo.png (256x256+) vorhanden
- [ ] Unraid Forum Support Thread erstellt
- [ ] unraid-template.xml vollständig ausgefüllt
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
- [ ] Nach Approval: In Forum-Thread ankündigen
- [ ] GitHub Release erstellen (v1.0.0)

## 📝 Wichtige Links

- **CA Templates Repo:** https://github.com/Squidly271/docker-templates
- **Unraid Forums:** https://forums.unraid.net/
- **Template Schema:** https://wiki.unraid.net/DockerTemplateSchema
- **GHCR Docs:** https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry

## 🎉 Nach erfolgreicher Submission

Deine App ist jetzt im Community Apps Store!

**Marketing (optional):**
- [ ] Reddit Post in r/unRAID
- [ ] Twitter/X Announcement
- [ ] Self-Hosted Discord Communities
- [ ] Update README mit "Available in CA" Badge

**Maintenance:**
- [ ] GitHub Watch aktivieren für Issues
- [ ] Forum-Thread regelmäßig checken
- [ ] Updates zeitnah veröffentlichen
- [ ] Security Patches prioritisieren

---

**Viel Erfolg! 🚀**
