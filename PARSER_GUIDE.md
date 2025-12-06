# TravStats Parser Guide

Umfassende Dokumentation des Multi-Provider Parser-Systems für Email- und Boarding Pass-Parsing.

## Inhaltsverzeichnis

- [Übersicht](#übersicht)
- [Vision Parser (Boarding Pass)](#vision-parser-boarding-pass)
- [Text Parser (Email)](#text-parser-email)
- [Konfiguration](#konfiguration)
- [API Keys Management](#api-keys-management)
- [Performance & Kosten](#performance--kosten)
- [Troubleshooting](#troubleshooting)

## Übersicht

TravStats bietet ein flexibles Parser-System mit **Auto-Mode** und **Fallback-Ketten**. Jeder User kann seinen bevorzugten Parser wählen oder das System automatisch den besten verfügbaren Parser auswählen lassen.

### Auto-Mode (Empfohlen)

Im Auto-Mode wählt das System automatisch den besten verfügbaren Parser basierend auf:

1. **Cloud AI** (OpenAI, Claude) – Beste Genauigkeit, erfordert API Key
2. **Local AI** (Ollama) – Gut, kostenlos, erfordert GPU
3. **OCR/Regex** (Tesseract, Regex) – Fallback, immer verfügbar

### Fallback-Ketten

Wenn der primäre Parser fehlschlägt, probiert das System automatisch die nächsten Parser in der Kette:

- **Vision**: `ollama → openai → claude → tesseract → manual`
- **Text**: `ollama → openai → claude → regex`

## Vision Parser (Boarding Pass)

### 1. Ollama Vision (llava, bakllava)

**Eigenschaften:**

- ✅ Kostenlos und lokal
- ✅ Gute Genauigkeit mit Vision Models
- ✅ Privacy-preserving (keine Daten verlassen Server)
- ❌ Benötigt GPU (empfohlen)
- ❌ Große Model-Downloads (~4-7GB)

**Setup:**

```bash
# Ollama installieren (einmalig)
curl -fsSL https://ollama.com/install.sh | sh

# Vision Model pullen
ollama pull llava:latest
# oder alternativ:
ollama pull bakllava

# Ollama starten
ollama serve
```

**Konfiguration:**

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_VISION_MODEL=llava:latest
```

**Hardware-Anforderungen:**

- **Minimum**: 8GB RAM, moderne CPU
- **Empfohlen**: 16GB RAM, NVIDIA GPU (4GB+ VRAM)
- **Optimal**: 32GB RAM, NVIDIA GPU (8GB+ VRAM)

### 2. OpenAI GPT-4 Vision

**Eigenschaften:**

- ✅ Exzellente Genauigkeit
- ✅ Schnelle Inferenz
- ✅ Keine lokale Hardware nötig
- ❌ Kostenpflichtig (~$0.01-0.05 pro Bild)
- ❌ Erfordert Internetverbindung
- ❌ Daten werden an OpenAI gesendet

**Setup:**

1. API Key besorgen: [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Key in `.env` eintragen oder in User Settings

**Konfiguration:**

```env
OPENAI_API_KEY=sk-...
OPENAI_VISION_MODEL=gpt-4o
```

**Kosten-Beispiel:**

- 10 Boarding Passes/Monat: ~$0.20
- 100 Boarding Passes/Monat: ~$2.00

### 3. Claude 3.5 Sonnet Vision

**Eigenschaften:**

- ✅ Exzellente Genauigkeit (oft besser als OpenAI)
- ✅ Starke strukturierte Datenextraktion
- ✅ Keine lokale Hardware nötig
- ❌ Kostenpflichtig (~$0.01-0.03 pro Bild)
- ❌ Erfordert Internetverbindung

**Setup:**

1. API Key besorgen: [https://console.anthropic.com/](https://console.anthropic.com/)
2. Key in `.env` eintragen oder in User Settings

**Konfiguration:**

```env
CLAUDE_API_KEY=sk-ant-...
CLAUDE_VISION_MODEL=claude-3-5-sonnet-20241022
```

### 4. Tesseract OCR

**Eigenschaften:**

- ✅ Komplett kostenlos
- ✅ Läuft lokal (keine API)
- ✅ Funktioniert ohne GPU
- ✅ Privacy-preserving
- ❌ Niedrigere Genauigkeit als AI Models
- ❌ Abhängig von Bildqualität

**Setup:**

Keine Konfiguration nötig! Läuft automatisch via `tesseract.js`.

**Funktionsweise:**

1. OCR extrahiert Text aus Bild
2. Regex-Patterns suchen nach Flugdaten
3. Smart Parsing mit bekannten Boarding Pass Layouts

**Best Practices:**

- Gute Beleuchtung beim Foto
- Boarding Pass gerade halten
- Hohe Auflösung (min. 1080p)

### 5. Manual Parser

**Eigenschaften:**

- ✅ Funktioniert immer (Ultimate Fallback)
- ✅ User hat volle Kontrolle
- ❌ Erfordert manuelle Dateneingabe

**Funktionsweise:**

1. Tesseract OCR extrahiert Text (wenn möglich)
2. User füllt fehlende Felder im Review Modal aus

## Text Parser (Email)

### 1. Ollama Text (qwen2.5, mistral, llama)

**Eigenschaften:**

- ✅ Kostenlos und lokal
- ✅ Gute Genauigkeit mit richtigen Models
- ✅ Privacy-preserving
- ❌ Benötigt gute Hardware
- ❌ Model-Downloads (~2-7GB)

**Setup:**

```bash
# Empfohlenes Model pullen
ollama pull qwen2.5:7b

# Alternativen:
ollama pull mistral:7b  # Gute multilingual support
ollama pull llama3.2:3b # Schneller, weniger genau
```

**Konfiguration:**

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
```

**Model-Vergleich:**

| Model        | Größe | Genauigkeit | Geschwindigkeit | Empfehlung      |
| ------------ | ----- | ----------- | --------------- | --------------- |
| qwen2.5:7b   | 4.7GB | ⭐⭐⭐⭐⭐  | ⭐⭐⭐         | ✅ Best Choice  |
| mistral:7b   | 4.1GB | ⭐⭐⭐⭐    | ⭐⭐⭐         | Multilingual    |
| llama3.2:3b  | 2.0GB | ⭐⭐⭐      | ⭐⭐⭐⭐        | Schnell         |
| llama3.2:1b  | 700MB | ⭐⭐        | ⭐⭐⭐⭐⭐      | Low-End Hardware|

### 2. OpenAI GPT-4 Text

**Eigenschaften:**

- ✅ Exzellente Genauigkeit
- ✅ Gute Multi-Flight Erkennung
- ❌ Kostenpflichtig (~$0.002-0.01 pro Email)

**Konfiguration:**

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4-turbo
```

**Kosten-Beispiel:**

- 50 Emails/Monat: ~$0.25
- 200 Emails/Monat: ~$1.00

### 3. Claude 3.5 Text

**Eigenschaften:**

- ✅ Exzellent für strukturierte Daten
- ✅ Starke multilingual Unterstützung
- ❌ Kostenpflichtig (~$0.003-0.015 pro Email)

**Konfiguration:**

```env
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

### 4. Regex Parser

**Eigenschaften:**

- ✅ Komplett kostenlos
- ✅ Sehr schnell
- ✅ Vorhersagbares Verhalten
- ❌ Niedrigere Genauigkeit
- ❌ Probleme mit nicht-standardisierten Formaten

**Funktionsweise:**

Pattern-Matching für:

- IATA Codes (3 Buchstaben)
- Flugnummern (2 Buchstaben + Ziffern)
- Dates/Times (ISO Format)
- PNR, Seat, Gate, Terminal
- Preise (EUR)

## Konfiguration

### Global (ENV-Level)

**Backend `.env`:**

```env
# Parser Auswahl (auto empfohlen)
VISION_PARSER=auto
TEXT_PARSER=auto

# Fallback Chains
VISION_FALLBACK=ollama,openai,claude,tesseract,manual
TEXT_FALLBACK=ollama,openai,claude,regex

# API Keys (optional)
OPENAI_API_KEY=
CLAUDE_API_KEY=
```

### User-Level (Settings UI)

Jeder User kann individuell konfigurieren:

1. **Preferred Parser**: Auto | Ollama | OpenAI | Claude | Tesseract | Manual
2. **Fallback Chain**: Drag & Drop Priorisierung
3. **User API Keys**: Eigene API Keys (falls Admin erlaubt)

**User Settings Zugriff:**

```
Dashboard → Settings → Parser Configuration
```

### Admin-Level (Admin Settings)

Admins können konfigurieren:

1. **Global API Keys**: OpenAI/Claude Keys für alle User
2. **User Permissions**:
   - Allow users to use their own API keys
   - Require users to provide their own API keys
3. **Default Settings**: Standard-Parser für neue User

**Admin Settings Zugriff:**

```
Dashboard → Admin Panel → Parser Settings
```

## API Keys Management

### Option 1: Global Keys (Admin-managed)

**Vorteile:**

- Einfache Verwaltung
- Zentrale Kostenkontrolle
- User brauchen keine eigenen Keys

**Nachteile:**

- Admin trägt alle Kosten
- Shared Quota für alle User

**Setup:**

```
Admin Panel → Parser Settings → Global API Keys
```

### Option 2: User Keys

**Vorteile:**

- Jeder User zahlt selbst
- Keine Admin-Kosten
- Separate Quotas

**Nachteile:**

- User müssen API Keys besorgen
- Komplexere Setup

**Setup:**

```
Settings → Parser Configuration → API Keys
```

### Option 3: Hybrid (Empfohlen)

**Funktionsweise:**

1. Admin setzt globale Keys (Fallback)
2. User können optionale eigene Keys nutzen
3. System nutzt: User Key → Global Key → Kostenlose Parser

**Setup:**

```
Admin: allowUserApiKeys = true
Admin: requireUserApiKeys = false
```

## Performance & Kosten

### Vision Parser Vergleich

| Provider       | Geschwindigkeit | Genauigkeit | Kosten/Bild | Hardware         |
| -------------- | --------------- | ----------- | ----------- | ---------------- |
| Ollama Vision  | ⭐⭐⭐         | ⭐⭐⭐⭐    | Kostenlos   | GPU empfohlen    |
| OpenAI GPT-4o  | ⭐⭐⭐⭐⭐      | ⭐⭐⭐⭐⭐  | $0.01-0.05  | Keine            |
| Claude 3.5     | ⭐⭐⭐⭐⭐      | ⭐⭐⭐⭐⭐  | $0.01-0.03  | Keine            |
| Tesseract OCR  | ⭐⭐⭐⭐        | ⭐⭐⭐      | Kostenlos   | Keine            |
| Manual         | ⭐             | ⭐⭐⭐⭐⭐  | Kostenlos   | Keine            |

### Text Parser Vergleich

| Provider      | Geschwindigkeit | Genauigkeit | Kosten/Email | Hardware      |
| ------------- | --------------- | ----------- | ------------ | ------------- |
| Ollama Text   | ⭐⭐⭐         | ⭐⭐⭐⭐    | Kostenlos    | CPU/GPU       |
| OpenAI GPT-4  | ⭐⭐⭐⭐⭐      | ⭐⭐⭐⭐⭐  | $0.002-0.01  | Keine         |
| Claude 3.5    | ⭐⭐⭐⭐⭐      | ⭐⭐⭐⭐⭐  | $0.003-0.015 | Keine         |
| Regex         | ⭐⭐⭐⭐⭐      | ⭐⭐        | Kostenlos    | Keine         |

### Empfohlene Setups

**Budget-Setup (Kostenlos):**

```env
VISION_PARSER=auto
TEXT_PARSER=auto
VISION_FALLBACK=ollama,tesseract,manual
TEXT_FALLBACK=ollama,regex
```

**Balanced Setup:**

```env
VISION_PARSER=auto
TEXT_PARSER=auto
VISION_FALLBACK=ollama,openai,tesseract,manual
TEXT_FALLBACK=ollama,openai,regex
OPENAI_API_KEY=sk-...
```

**Premium Setup (Beste Genauigkeit):**

```env
VISION_PARSER=auto
TEXT_PARSER=auto
VISION_FALLBACK=claude,openai,ollama,tesseract
TEXT_FALLBACK=claude,openai,ollama,regex
CLAUDE_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Troubleshooting

### Ollama verbindet nicht

**Problem:** `Ollama service unavailable`

**Lösung:**

```bash
# Check ob Ollama läuft
curl http://localhost:11434/api/tags

# Ollama starten
ollama serve

# Model installieren
ollama pull llava:latest
ollama pull qwen2.5:7b
```

### OpenAI API Error

**Problem:** `Invalid OpenAI API key`

**Lösung:**

1. API Key prüfen: [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Guthaben prüfen: [https://platform.openai.com/usage](https://platform.openai.com/usage)
3. Key in `.env` korrekt eingetragen?

### Claude API Error

**Problem:** `Invalid Claude API key`

**Lösung:**

1. API Key Format: Muss mit `sk-ant-` beginnen
2. Key prüfen: [https://console.anthropic.com/](https://console.anthropic.com/)
3. Key in `.env` korrekt eingetragen?

### Tesseract schlechte Erkennung

**Problem:** OCR erkennt Boarding Pass nicht

**Lösung:**

1. **Besseres Foto**: Gut beleuchtet, scharf, gerade
2. **Höhere Auflösung**: Mindestens 1080p
3. **Kontrast**: Weißer Hintergrund empfohlen
4. **Fallback**: Manual Parser verwenden

### Parser wählt falschen Provider

**Problem:** System nutzt nicht bevorzugten Parser

**Lösung:**

1. Check User Settings: Ist `preferredVisionParser` gesetzt?
2. Check Availability: `/api/v1/parse-boardingpass/providers`
3. Check API Keys: Sind sie korrekt konfiguriert?
4. Check Logs: Backend Console für Fehlermeldungen

### Rate Limits

**Problem:** `OpenAI API rate limit exceeded`

**Lösung:**

1. **Warten**: Rate Limits resetten nach Zeit
2. **Upgrade**: Höheres OpenAI Tier
3. **Fallback**: Auto-Mode nutzt automatisch nächsten Parser
4. **Alternative**: Claude oder Ollama verwenden

## Best Practices

### Für Admins

1. **Global Keys**: Setze globale API Keys für einfachen Start
2. **Monitoring**: Überwache API-Kosten regelmäßig
3. **Limits**: Setze Budget Limits in OpenAI/Claude Console
4. **Fallbacks**: Aktiviere immer Tesseract/Regex als Fallback
5. **Dokumentation**: Weise User auf PARSER_GUIDE.md hin

### Für User

1. **Auto-Mode**: Nutze Auto-Mode für beste Ergebnisse
2. **Foto-Qualität**: Gute Beleuchtung = bessere Erkennung
3. **Review**: Prüfe geparste Daten immer im Review Modal
4. **Eigene Keys**: Nutze eigene API Keys für mehr Kontrolle
5. **Feedback**: Melde Parser-Probleme an Admin

### Für Entwickler

1. **Logs**: Check Backend Console bei Problemen
2. **Tests**: Teste alle Parser mit Sample Data
3. **Caching**: Availability Cache ist 5 Minuten TTL
4. **Error Handling**: Alle Parser haben Fallback-Logic
5. **Extensions**: Neue Parser in `backend/src/services/parsers/`

## Weitere Ressourcen

- **Ollama Docs**: [https://github.com/ollama/ollama](https://github.com/ollama/ollama)
- **OpenAI Vision API**: [https://platform.openai.com/docs/guides/vision](https://platform.openai.com/docs/guides/vision)
- **Claude Vision**: [https://docs.anthropic.com/claude/docs/vision](https://docs.anthropic.com/claude/docs/vision)
- **Tesseract.js**: [https://tesseract.projectnaptha.com/](https://tesseract.projectnaptha.com/)
