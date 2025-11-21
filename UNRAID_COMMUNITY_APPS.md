# TravStats - Unraid Community Apps Submission

Diese Anleitung erklärt, wie du TravStats in den Unraid Community Apps Store einreichst.

## 🎯 Voraussetzungen

Um TravStats in den Community Apps Store zu bekommen, brauchst du:

1. **Docker Image auf Docker Hub oder GitHub Container Registry (GHCR)**
2. **XML Template** (bereits vorhanden: `unraid-template.xml`)
3. **GitHub Repository** (öffentlich)
4. **Icon/Logo** für die App

---

## 📦 Schritt 1: Docker Image veröffentlichen

### Option A: GitHub Container Registry (GHCR) - Empfohlen

**Vorteile:**
- Kostenlos
- Unbegrenzte Images
- Integriert mit GitHub
- Private und öffentliche Images

**1. GitHub Personal Access Token erstellen:**

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. **Generate new token (classic)**
3. Scopes auswählen:
   - `write:packages`
   - `read:packages`
   - `delete:packages`
4. Token kopieren und sicher speichern

**2. Docker Login zu GHCR:**

```bash
# Token als Umgebungsvariable
export CR_PAT=YOUR_TOKEN

# Login
echo $CR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

**3. Image bauen und pushen:**

```bash
# Zum Projekt-Verzeichnis
cd D:\Projekte\TravStats

# Image bauen mit GHCR Tag
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest .

# Image pushen
docker push ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest

# Auch mit Version-Tag
docker tag ghcr.io/YOUR_GITHUB_USERNAME/travstats:latest ghcr.io/YOUR_GITHUB_USERNAME/travstats:1.0.0
docker push ghcr.io/YOUR_GITHUB_USERNAME/travstats:1.0.0
```

**4. Image öffentlich machen:**

1. GitHub → Dein Profil → **Packages**
2. `travstats` Package auswählen
3. **Package settings** → **Change visibility** → **Public**

### Option B: Docker Hub

**1. Docker Hub Account erstellen:**
- https://hub.docker.com/signup

**2. Login:**

```bash
docker login
```

**3. Image bauen und pushen:**

```bash
cd D:\Projekte\TravStats

# Image bauen
docker build -t YOUR_DOCKERHUB_USERNAME/travstats:latest .

# Image pushen
docker push YOUR_DOCKERHUB_USERNAME/travstats:latest

# Mit Version
docker tag YOUR_DOCKERHUB_USERNAME/travstats:latest YOUR_DOCKERHUB_USERNAME/travstats:1.0.0
docker push YOUR_DOCKERHUB_USERNAME/travstats:1.0.0
```

---

## 🖼️ Schritt 2: Icon erstellen

**Anforderungen:**
- Format: PNG
- Größe: 256x256 px oder höher
- Transparenter Hintergrund (empfohlen)
- Gute Sichtbarkeit in Hell- und Dunkelmodus

**Icon hosten:**
- Im GitHub Repository: `https://raw.githubusercontent.com/USERNAME/travstats/main/logo.png`
- Oder: Externe Hosting-Dienste (imgur, etc.)

---

## 📝 Schritt 3: XML Template anpassen

Die Datei `unraid-template.xml` muss angepasst werden:

### Wichtige Änderungen:

```xml
<!-- Dein Docker Image Repository anpassen -->
<Repository>ghcr.io/YOUR_USERNAME/travstats:latest</Repository>

<!-- GitHub Links anpassen -->
<Support>https://github.com/YOUR_USERNAME/travstats/issues</Support>
<Project>https://github.com/YOUR_USERNAME/travstats</Project>

<!-- Template URL anpassen -->
<TemplateURL>https://raw.githubusercontent.com/YOUR_USERNAME/travstats/main/unraid-template.xml</TemplateURL>

<!-- Icon URL anpassen -->
<Icon>https://raw.githubusercontent.com/YOUR_USERNAME/travstats/main/logo.png</Icon>
```

### Vollständiges Beispiel:

```xml
<?xml version="1.0"?>
<Container version="2">
  <Name>TravStats</Name>
  <Repository>ghcr.io/yourname/travstats:latest</Repository>
  <Registry>https://ghcr.io</Registry>
  <Network>bridge</Network>
  <Shell>sh</Shell>
  <Privileged>false</Privileged>
  <Support>https://github.com/yourname/travstats/issues</Support>
  <Project>https://github.com/yourname/travstats</Project>
  <Overview>
    TravStats - Flight Tracking &amp; Statistics Dashboard

    Track your flights, visualize routes on an interactive map, and unlock achievements.

    Features:
    - Interactive world map with flight paths
    - Airport statistics and visit tracking
    - 58 achievements (Battlefield-style)
    - Dark mode support
    - Advanced statistics

    REQUIRES: PostgreSQL database container (see setup guide)
  </Overview>
  <Category>Status:Stable Tools:</Category>
  <WebUI>http://[IP]:[PORT:3000]/</WebUI>
  <TemplateURL>https://raw.githubusercontent.com/yourname/travstats/main/unraid-template.xml</TemplateURL>
  <Icon>https://raw.githubusercontent.com/yourname/travstats/main/logo.png</Icon>
  <ExtraParams>--link travstats-db:db</ExtraParams>
  <Requires>
    PostgreSQL with PostGIS: Install "postgis/postgis" container first with name "travstats-db"
  </Requires>

  <!-- Port Configuration -->
  <Config Name="WebUI Port" Target="80" Default="3000" Mode="tcp"
          Description="Web interface port" Type="Port" Display="always"
          Required="true" Mask="false">3000</Config>

  <!-- Environment Variables -->
  <Config Name="Database URL" Target="DATABASE_URL"
          Default="postgresql://flights:your-password@db:5432/flights"
          Mode="" Description="PostgreSQL connection string"
          Type="Variable" Display="always" Required="true" Mask="false">
    postgresql://flights:changeme@db:5432/flights
  </Config>

  <Config Name="JWT Secret" Target="JWT_SECRET" Default="" Mode=""
          Description="Secret key for JWT tokens (generate with: openssl rand -hex 32)"
          Type="Variable" Display="always" Required="true" Mask="true"></Config>

  <Config Name="Seed Airports" Target="SEED_AIRPORTS" Default="true|false"
          Mode="" Description="Auto-populate airports database on first start"
          Type="Variable" Display="always" Required="false" Mask="false">true</Config>

  <Config Name="Node Environment" Target="NODE_ENV" Default="production"
          Mode="" Description="Node.js environment"
          Type="Variable" Display="advanced" Required="false" Mask="false">production</Config>

  <Config Name="Backend Port" Target="PORT" Default="8000" Mode=""
          Description="Internal backend API port"
          Type="Variable" Display="advanced" Required="false" Mask="false">8000</Config>
</Container>
```

---

## 🚀 Schritt 4: Template in GitHub hochladen

**1. Dateien committen:**

```bash
cd D:\Projekte\TravStats

git add unraid-template.xml
git add logo.png  # Dein Icon
git commit -m "Add Unraid Community Apps template"
git push origin main
```

**2. Raw-URL testen:**

Öffne im Browser:
```
https://raw.githubusercontent.com/YOUR_USERNAME/travstats/main/unraid-template.xml
```

Sollte das XML direkt anzeigen.

---

## 📤 Schritt 5: Bei Community Apps einreichen

**Zwei Optionen:**

### Option A: Pull Request im CA-Templates Repository (Offiziell)

1. **Fork das Repository:**
   - https://github.com/Squidly271/docker-templates

2. **Dein Template hinzufügen:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/docker-templates
   cd docker-templates

   # Template in den "templates" Ordner kopieren
   mkdir -p templates/yourname
   cp /path/to/unraid-template.xml templates/yourname/travstats.xml

   git add templates/yourname/travstats.xml
   git commit -m "Add TravStats - Flight Tracking Dashboard"
   git push origin main
   ```

3. **Pull Request erstellen:**
   - GitHub → Original Repository → **Pull Request**
   - Beschreibe deine App
   - Warte auf Review

### Option B: Eigenes Template Repository (Schneller)

**Nutzer können deine App hinzufügen ohne auf CA-Approval zu warten:**

1. **Template-URL in GitHub veröffentlichen**
2. **Nutzer fügen dein Repository in Unraid hinzu:**

In Unraid:
1. **Docker** Tab → **Add Template Repositories**
2. Template URL hinzufügen:
   ```
   https://raw.githubusercontent.com/YOUR_USERNAME/travstats/main/unraid-template.xml
   ```
3. **Save**
4. Container ist jetzt unter "Add Container" → "TravStats" verfügbar

---

## ✅ Checkliste vor Submission

- [ ] **Docker Image ist öffentlich verfügbar**
  - Auf GHCR oder Docker Hub
  - Mit `latest` und Version-Tags

- [ ] **XML Template ist vollständig**
  - Alle URLs angepasst
  - Repository URL korrekt
  - Icon URL funktioniert
  - Support/Project Links gesetzt

- [ ] **Icon ist vorhanden**
  - 256x256 px oder größer
  - PNG Format
  - Öffentlich zugänglich

- [ ] **README.md im GitHub Repository**
  - Installation-Anleitung
  - Features beschrieben
  - Screenshots (optional aber empfohlen)

- [ ] **Lizenz im Repository**
  - MIT, GPL, Apache, etc.
  - LICENSE Datei vorhanden

- [ ] **Dokumentation**
  - UNRAID_SETUP.md hochgeladen
  - Klare Installations-Schritte

- [ ] **Getestet**
  - Container funktioniert aus Image
  - Alle Environment Variables korrekt
  - Datenbank-Verbindung funktioniert

---

## 🔄 GitHub Actions für automatische Builds (Optional)

Automatisiere das Image-Building mit GitHub Actions:

**Datei:** `.github/workflows/docker-build.yml`

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
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

**Aktivierung:**
1. Diese Datei in dein Repository committen
2. GitHub Actions sind automatisch aktiviert
3. Bei jedem Push auf `main` wird das Image automatisch gebaut

---

## 📊 Marketing (Optional)

**Um mehr Nutzer zu erreichen:**

1. **Unraid Forums Post:**
   - https://forums.unraid.net/
   - Kategorie: "Docker Containers"
   - Beschreibe Features, Screenshots, Download-Link

2. **Reddit:**
   - r/unRAID
   - Post mit Screenshots und Link

3. **GitHub README verbessern:**
   - Badges hinzufügen (Docker Pulls, Version, etc.)
   - Screenshots der UI
   - Feature-Liste
   - Demo-Video (optional)

---

## 🛠️ Updates veröffentlichen

**Neue Version releasen:**

1. **Code ändern und testen**

2. **Version taggen:**
```bash
git tag -a v1.1.0 -m "Version 1.1.0 - Added feature X"
git push origin v1.1.0
```

3. **Docker Image bauen und pushen:**
```bash
docker build -t ghcr.io/yourname/travstats:1.1.0 .
docker push ghcr.io/yourname/travstats:1.1.0

docker tag ghcr.io/yourname/travstats:1.1.0 ghcr.io/yourname/travstats:latest
docker push ghcr.io/yourname/travstats:latest
```

4. **GitHub Release erstellen:**
   - GitHub → Releases → New Release
   - Tag: v1.1.0
   - Changelog schreiben
   - Publish

---

## 📞 Support

**Wenn Nutzer Probleme haben:**

1. **GitHub Issues** für Bug Reports
2. **GitHub Discussions** für Fragen
3. **Unraid Forum Thread** für Community-Support

---

## ✨ Fertig!

Nach erfolgreicher Submission ist TravStats im Unraid Community Apps Store verfügbar!

**Nutzer können dann:**
1. Community Apps öffnen
2. Nach "TravStats" suchen
3. Mit einem Klick installieren

**Viel Erfolg! 🚀**
