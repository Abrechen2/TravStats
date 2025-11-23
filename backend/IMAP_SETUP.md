# IMAP Email Import Setup Guide

Der IMAP Email-Import ermöglicht es, Flugbestätigungen automatisch aus deinem E-Mail-Postfach zu importieren.

## 📋 Übersicht

Das System besteht aus drei Komponenten:

1. **IMAP Poller** - Holt ungelesene E-Mails ab
2. **Booking Parser** - Extrahiert Flugdaten mit Regex
3. **Import API** - Verwaltet importierte Flüge (Review, Accept, Reject)

## 🔧 Setup für Gmail

### Schritt 1: App-spezifisches Passwort erstellen

Gmail erlaubt keine normalen Passwörter für IMAP-Zugriff. Du brauchst ein App-spezifisches Passwort:

1. Gehe zu [Google Account Security](https://myaccount.google.com/security)
2. Aktiviere **2-Faktor-Authentifizierung** (falls noch nicht aktiv)
3. Gehe zu **App-Passwörter** (unter "Bei Google anmelden")
4. Wähle **App**: Mail, **Gerät**: Anderes (benutzerdefinierter Name)
5. Gib einen Namen ein: `TravStats IMAP`
6. Klicke auf **Erstellen**
7. **Kopiere das 16-stellige Passwort** (wird nur einmal angezeigt!)

### Schritt 2: .env Konfiguration

Öffne `backend/.env` und fülle die IMAP-Variablen aus:

```env
# IMAP aktivieren
IMAP_ENABLED=true

# Gmail IMAP Server
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_SECURE=true

# Deine Gmail-Adresse
IMAP_USER=deine-email@gmail.com

# Das App-spezifische Passwort von Schritt 1
IMAP_PASSWORD=abcd efgh ijkl mnop

# Deine User-ID aus der Datenbank
IMAP_DEFAULT_USER_ID=deine-user-id-hier

# Polling-Intervall in Minuten
IMAP_POLL_INTERVAL=5

# Geheimer Schlüssel für Webhook-Import
IMPORT_SECRET=ein-zufälliger-geheimer-schlüssel
```

### Schritt 3: User-ID herausfinden

Du brauchst deine User-ID aus der Datenbank. Führe aus:

```bash
cd backend
npx ts-node -e "
import { prisma } from './src/db';
prisma.user.findMany().then(users => {
  users.forEach(u => console.log('User:', u.email, 'ID:', u.id));
  process.exit(0);
});
"
```

Kopiere die ID und setze sie als `IMAP_DEFAULT_USER_ID`.

### Schritt 4: IMAP Poller starten

Der IMAP Poller läuft als separater Service. Erstelle ein neues Script:

```bash
cd backend
npx ts-node src/services/runImapPoller.ts
```

Oder erstelle `src/services/runImapPoller.ts`:

```typescript
import { pollImapAndImport } from './imapPoller';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  host: process.env.IMAP_HOST || 'imap.gmail.com',
  port: Number(process.env.IMAP_PORT) || 993,
  secure: process.env.IMAP_SECURE === 'true',
  user: process.env.IMAP_USER || '',
  password: process.env.IMAP_PASSWORD || '',
};

const defaultUserId = process.env.IMAP_DEFAULT_USER_ID;
const pollInterval = Number(process.env.IMAP_POLL_INTERVAL) || 5;

async function poll() {
  if (process.env.IMAP_ENABLED !== 'true') {
    console.log('IMAP is disabled. Set IMAP_ENABLED=true in .env');
    return;
  }

  console.log(`Starting IMAP poller (checking every ${pollInterval} minutes)...`);

  while (true) {
    try {
      console.log(`[${new Date().toISOString()}] Checking for new emails...`);
      await pollImapAndImport(config, defaultUserId);
      console.log('✓ Poll completed');
    } catch (error: any) {
      console.error('✗ Poll failed:', error.message);
    }

    // Wait for next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval * 60 * 1000));
  }
}

poll();
```

Dann starte es:

```bash
npx ts-node src/services/runImapPoller.ts
```

## 🔍 Wie der Parser funktioniert

Der Booking Parser extrahiert Flugdaten mit folgenden Regex-Patterns:

```typescript
// IATA Airport Codes (3 Buchstaben)
/\b([A-Z]{3})\b/g
// Beispiel: FRA, JFK, LHR

// Flugnummer (2-3 Buchstaben + 1-4 Ziffern)
/\b([A-Z]{2,3}\s?\d{1,4})\b/
// Beispiel: LH400, BA 123

// PNR (6 alphanumerische Zeichen)
/\b([A-Z0-9]{6})\b/
// Beispiel: ABC123

// Datum/Zeit (ISO Format)
/\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\b/
// Beispiel: 2025-11-23 14:30

// Sitzplatz (1-2 Ziffern + Buchstabe)
/\b([0-9]{1,2}[A-Z])\b/
// Beispiel: 12A, 5F

// Preis
/(\d{1,5}[.,]\d{2})\s?(EUR|€)/i
// Beispiel: 299.00 EUR, 450,50€
```

## 📧 Unterstützte E-Mail-Formate

Der Parser arbeitet am besten mit strukturierten Bestätigungsmails von Airlines wie:

- **Lufthansa** - ✓ Gut unterstützt
- **British Airways** - ✓ Gut unterstützt
- **Ryanair** - ⚠️ Teilweise (kein PNR-Format)
- **Eurowings** - ✓ Gut unterstützt
- **KLM** - ✓ Gut unterstützt

Wichtig: Die E-Mail sollte enthalten:
- ✅ Flugnummer (z.B. LH400)
- ✅ Abflug- und Ankunfts-IATA-Code (z.B. FRA → JFK)
- ✅ Datum und Uhrzeit im ISO-Format
- ⚠️ Optional: PNR, Sitzplatz, Gate, Terminal, Preis

## 🧪 Testen

### Manueller Import per API

Du kannst Flüge auch manuell importieren:

```bash
curl -X POST http://localhost:8000/imports/email \
  -H "Content-Type: application/json" \
  -H "x-import-secret: dein-secret-aus-env" \
  -d '{
    "userId": "deine-user-id",
    "subject": "Ihre Lufthansa Buchungsbestätigung",
    "text": "Flugnummer: LH400\nVon: FRA\nNach: JFK\nAbflug: 2025-11-25 10:30\nAnkunft: 2025-11-25 14:45\nPNR: ABC123\nSitzplatz: 12A\nPreis: 450.00 EUR",
    "html": "",
    "from": "lufthansa@example.com",
    "to": "you@example.com"
  }'
```

### Pending Imports abrufen

```bash
curl -X GET http://localhost:8000/imports/pending \
  -H "Authorization: Bearer dein-jwt-token"
```

### Import akzeptieren

```bash
curl -X POST http://localhost:8000/imports/{import-id}/accept \
  -H "Authorization: Bearer dein-jwt-token"
```

## 🎯 Frontend Integration

Im Dashboard siehst du die importierten Flüge:

1. **Badge** neben "Flug hinzufügen" zeigt Anzahl pending imports
2. **"Importierte Flüge"** Section in der Flugliste
3. **Review-Buttons**: ✓ Akzeptieren oder ✗ Ablehnen

## 🔐 Sicherheit

- **IMPORT_SECRET**: Schützt den Webhook-Endpoint vor unbefugtem Zugriff
- **IMAP_PASSWORD**: Wird nur serverseitig verwendet, niemals ans Frontend gesendet
- **JWT Authentication**: Alle Import-Actions erfordern Login

## 🛠️ Troubleshooting

### "Authentication failed"
- Prüfe, ob du ein **App-spezifisches Passwort** verwendest (nicht dein normales Gmail-Passwort)
- Stelle sicher, dass 2FA aktiviert ist

### "Connection refused"
- Port 993 muss offen sein
- `IMAP_SECURE=true` für Gmail

### "No emails found"
- Der Poller liest nur **ungelesene** E-Mails
- E-Mails werden nach Import als gelesen markiert
- Prüfe dein Postfach auf ungelesene Buchungsbestätigungen

### Parser erkennt Flugdaten nicht
- Prüfe die E-Mail-Struktur
- Erweitere die Regex-Patterns in `bookingParser.ts` für spezielle Airlines
- Kontaktiere Support für neue Patterns

## 📊 Parser verbessern

Für spezielle Airlines kannst du eigene Patterns hinzufügen:

```typescript
// In bookingParser.ts

// Ryanair-spezifischer Parser
const RYANAIR_BOOKING_REF = /Booking Reference:\s*([A-Z0-9]{6})/i;

// Lufthansa E-Ticket Number
const LH_ETICKET = /E-Ticket:\s*(\d{13})/i;

// British Airways Tier Points
const BA_TIER_POINTS = /Tier Points:\s*(\d+)/i;
```

## 🚀 Produktions-Deployment

Für Production:

1. **Separater IMAP Account**: Erstelle einen dedizierten Email-Account nur für Flugbestätigungen
2. **Forwarding Rules**: Leite Bestätigungsmails automatisch weiter
3. **Monitoring**: Logge alle Imports und Fehler
4. **Rate Limiting**: Setze `IMAP_POLL_INTERVAL` auf mindestens 5 Minuten
5. **Backup**: Sichere die `importedFlight` Tabelle regelmäßig

## 📚 Weitere Ressourcen

- [ImapFlow Dokumentation](https://github.com/postalsys/imapflow)
- [Mailparser Dokumentation](https://nodemailer.com/extras/mailparser/)
- [Gmail IMAP Setup](https://support.google.com/mail/answer/7126229)

---

**Fragen oder Probleme?** Öffne ein Issue im Repository!
