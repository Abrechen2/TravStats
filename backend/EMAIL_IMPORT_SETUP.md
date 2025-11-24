# Email Import Setup - E-Mail an Server senden

Der einfachste Weg, Flugbestätigungen zu importieren: **E-Mail einfach an den Server weiterleiten!**

## 🎯 Konzept

1. **Flugbestätigung** kommt in dein Postfach (z.B. von Lufthansa)
2. **Weiterleiten** an eine spezielle Import-Adresse
3. **Email-to-Webhook Service** sendet E-Mail als HTTP POST an deinen Server
4. **Server parst** automatisch Flugdaten und legt sie zur Review bereit

## 🚀 Setup mit Email-to-Webhook Service

Es gibt mehrere kostenlose Services, die E-Mails empfangen und als HTTP-Request an deinen Server senden:

### Option 1: CloudMailin (Empfohlen - Einfach & Kostenlos)

**Vorteile:**
- ✅ Kostenlos bis 10.000 E-Mails/Monat
- ✅ Sehr einfaches Setup
- ✅ Keine Kreditkarte nötig
- ✅ Sofort einsatzbereit

**Setup:**

1. **Account erstellen**: [cloudmailin.com](https://www.cloudmailin.com)

2. **Neue Adresse erstellen**:
   - Gehe zu "Addresses" → "New Address"
   - Du bekommst eine Adresse wie: `abc123@cloudmailin.net`

3. **Webhook konfigurieren**:
   - **HTTP POST URL**: `https://deine-domain.com/imports/email`
   - **Format**: `JSON`
   - **Headers hinzufügen**:
     ```
     x-import-secret: dein-geheimer-schlüssel
     ```

4. **Body Mapping** (CloudMailin → TravStats):
   ```json
   {
     "userId": "deine-user-id-hier",
     "subject": "{{envelope.subject}}",
     "text": "{{plain}}",
     "html": "{{html}}",
     "from": "{{envelope.from}}",
     "to": "{{envelope.to}}"
   }
   ```

5. **Testen**: Sende Test-E-Mail an `abc123@cloudmailin.net`

### Option 2: SendGrid Inbound Parse

**Vorteile:**
- ✅ Kostenlos
- ✅ Sehr zuverlässig
- ✅ Eigene Domain nutzbar (z.B. import@meinedomain.com)

**Setup:**

1. **SendGrid Account**: [sendgrid.com](https://sendgrid.com)

2. **Domain verifizieren** (optional):
   - Settings → Sender Authentication
   - Füge DNS-Records hinzu

3. **Inbound Parse einrichten**:
   - Settings → Inbound Parse → Add Host & URL
   - **Hostname**: `import.meinedomain.com` (oder SendGrid-Subdomain)
   - **Destination URL**: `https://deine-domain.com/imports/email`
   - **POST data as**: `Parsed`

4. **Middleware für SendGrid-Format** (in Express):
   ```typescript
   // In routes/imports.ts
   router.post('/email/sendgrid', async (req: Request, res: Response) => {
     const { subject, text, html, from, to, envelope } = req.body;

     // Extrahiere userId aus "to" (z.B. dennis-abc123@import.meinedomain.com)
     const userId = extractUserIdFromEmail(to);

     const parsed = parseBookingEmail(subject, text, html);

     await prisma.importedFlight.create({
       data: {
         id: uuidv4(),
         userId,
         status: 'pending_review',
         subject,
         fromAddress: from,
         toAddress: to,
         raw: text.slice(0, 8000),
         parsed: parsed as any,
       },
     });

     res.status(200).send('OK');
   });
   ```

### Option 3: Mailgun Routes

**Vorteile:**
- ✅ Kostenlos (5.000 E-Mails/Monat)
- ✅ Eigene Domain
- ✅ Flexible Routing-Regeln

**Setup:**

1. **Mailgun Account**: [mailgun.com](https://mailgun.com)

2. **Domain hinzufügen**: Verifiziere deine Domain

3. **Route erstellen**:
   - Receiving → Routes → Create Route
   - **Expression**: `match_recipient("import@meinedomain.com")`
   - **Actions**: `forward("https://deine-domain.com/imports/email")`
   - **Headers**:
     ```
     x-import-secret: dein-geheimer-schlüssel
     ```

## 🔧 Server-Konfiguration

### .env Setup

```env
# Import Secret (für Webhook-Authentifizierung)
IMPORT_SECRET=ein-sehr-langer-zufälliger-geheimer-schlüssel-12345
```

Generiere einen sicheren Secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Bestehender Endpoint

Der Endpoint `/imports/email` ist bereits implementiert in [routes/imports.ts](src/routes/imports.ts:19):

```typescript
router.post('/email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Prüfe Secret
    if (!verifyImportSecret(req)) {
      return res.status(401).json({ error: 'Unauthorized import' });
    }

    const { userId, subject, text, html, from, to } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // Parse Flugdaten
    const parsed = parseBookingEmail(subject, text, html);

    // Speichere als ImportedFlight
    const draft = await prisma.importedFlight.create({
      data: {
        id: uuidv4(),
        userId,
        status: 'pending_review',
        subject,
        fromAddress: from,
        toAddress: to,
        raw: text.slice(0, 8000),
        parsed: parsed as any,
      },
    });

    res.json({ id: draft.id, status: draft.status });
  } catch (error) {
    next(error);
  }
});
```

## 📧 User Workflow

### 1. Flugbestätigung erhalten
User bekommt E-Mail von Lufthansa mit Buchungsbestätigung.

### 2. Weiterleiten
User leitet E-Mail weiter an: `abc123@cloudmailin.net`

### 3. Automatischer Import
CloudMailin sendet E-Mail an deinen Server → Parser extrahiert Daten → ImportedFlight wird erstellt

### 4. Review im Dashboard
User sieht Badge "1" neben "Flug hinzufügen" → Klickt auf Import → Akzeptiert ✓

### 5. Flug erstellt
Flug erscheint auf der Karte!

## 🎨 User-spezifische Import-Adressen

Um verschiedene User zu unterstützen, kannst du die userId im "to"-Feld kodieren:

### Variante A: Plus-Adressierung
```
import+dennis@meinedomain.com  → User "dennis"
import+maria@meinedomain.com   → User "maria"
```

### Variante B: Subdomain
```
dennis@import.meinedomain.com  → User "dennis"
maria@import.meinedomain.com   → User "maria"
```

### Variante C: Hash
```
import-3239e2cf@meinedomain.com  → User mit ID 3239e2cf...
```

### Implementierung in Express:

```typescript
// Helper-Funktion
function extractUserIdFromEmail(toAddress: string): string | undefined {
  // Variante A: Plus-Adressierung
  const plusMatch = toAddress.match(/import\+(\w+)@/);
  if (plusMatch) {
    const username = plusMatch[1];
    // Lookup userId by username
    return lookupUserIdByUsername(username);
  }

  // Variante B: Subdomain
  const subdomainMatch = toAddress.match(/^(\w+)@import\./);
  if (subdomainMatch) {
    const username = subdomainMatch[1];
    return lookupUserIdByUsername(username);
  }

  // Variante C: Hash
  const hashMatch = toAddress.match(/import-([a-f0-9-]+)@/);
  if (hashMatch) {
    return hashMatch[1];
  }

  return undefined;
}

// Endpoint mit automatischer userId-Erkennung
router.post('/email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!verifyImportSecret(req)) {
      return res.status(401).json({ error: 'Unauthorized import' });
    }

    let { userId, subject, text, html, from, to } = req.body;

    // Falls userId nicht mitgesendet, aus "to" extrahieren
    if (!userId && to) {
      userId = extractUserIdFromEmail(to);
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId required or could not be extracted' });
    }

    const parsed = parseBookingEmail(subject, text, html);

    const draft = await prisma.importedFlight.create({
      data: {
        id: uuidv4(),
        userId,
        status: 'pending_review',
        subject,
        fromAddress: from,
        toAddress: to,
        raw: text.slice(0, 8000),
        parsed: parsed as any,
      },
    });

    res.json({ id: draft.id, status: draft.status });
  } catch (error) {
    next(error);
  }
});
```

## 🧪 Testen

### Manuell mit curl:

```bash
curl -X POST https://deine-domain.com/imports/email \
  -H "Content-Type: application/json" \
  -H "x-import-secret: dein-secret" \
  -d '{
    "userId": "3239e2cf-8877-4d18-b318-533d62130703",
    "subject": "Ihre Lufthansa Buchungsbestätigung LH400",
    "text": "Sehr geehrter Herr Müller,\n\nVielen Dank für Ihre Buchung.\n\nFlugnummer: LH400\nVon: Frankfurt (FRA)\nNach: New York JFK (JFK)\nAbflug: 2025-12-15 10:30\nAnkunft: 2025-12-15 14:45\nBuchungscode: ABC123\nSitzplatz: 12A\nTerminal: 1\nGate: A25\nPreis: 450,00 EUR",
    "html": "<html>...</html>",
    "from": "noreply@lufthansa.com",
    "to": "import@meinedomain.com"
  }'
```

### Mit echter E-Mail:

1. Sende E-Mail an deine CloudMailin-Adresse
2. Schaue in CloudMailin Dashboard → "Message Log"
3. Prüfe ob Request erfolgreich (Status 200)
4. Checke Dashboard → sollte Badge "1" zeigen

## 🔐 Sicherheit

### 1. IMPORT_SECRET schützt Endpoint
Nur Requests mit richtigem Secret werden akzeptiert:
```typescript
const secret = process.env.IMPORT_SECRET;
const header = req.headers['x-import-secret'] || req.query.secret;
return header === secret;
```

### 2. Rate Limiting (empfohlen)
```bash
npm install express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 10, // Max 10 Imports pro IP
  message: 'Too many imports, please try again later',
});

router.post('/email', importLimiter, async (req, res, next) => {
  // ...
});
```

### 3. E-Mail Validation
Prüfe, ob E-Mail von bekannter Airline kommt:
```typescript
const allowedSenders = [
  '@lufthansa.com',
  '@britishairways.com',
  '@ryanair.com',
  '@eurowings.com',
];

const isAllowedSender = allowedSenders.some(domain =>
  from.toLowerCase().includes(domain)
);

if (!isAllowedSender) {
  console.warn('Email from unknown sender:', from);
}
```

## 📱 Frontend: User-Anleitung einblenden

Zeige im Frontend die Import-Adresse an:

```typescript
// In DashboardPage oder Settings
<div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
    📧 Automatischer Flug-Import
  </h3>
  <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
    Leite deine Flugbestätigungen an diese Adresse weiter:
  </p>
  <code className="block bg-white dark:bg-gray-800 px-3 py-2 rounded border border-blue-200 dark:border-blue-700 text-sm font-mono">
    import-{user.id.slice(0, 8)}@travstats.com
  </code>
  <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">
    Die Flugdaten werden automatisch erkannt und zur Review bereitgestellt.
  </p>
</div>
```

## 🔄 Vergleich: Email-to-Webhook vs. IMAP-Poller

| Feature | Email-to-Webhook (empfohlen) | IMAP-Poller |
|---------|------------------------------|-------------|
| Setup | ✅ Einfach (5 Min) | ⚠️ Komplex (Gmail App-Passwort) |
| Performance | ✅ Sofort | ⚠️ Verzögert (Polling-Intervall) |
| Server Load | ✅ Minimal | ⚠️ Dauerhaft laufender Prozess |
| Kosten | ✅ Kostenlos | ✅ Kostenlos |
| Eigene Domain | ✅ Möglich | ❌ Nicht relevant |
| User Experience | ✅ "Weiterleiten-Button" | ⚠️ E-Mail muss im Postfach bleiben |

## 🚀 Produktions-Setup

1. **Domain kaufen** (optional): `import.travstats.com`
2. **CloudMailin einrichten** mit eigener Domain
3. **HTTPS aktivieren** (Let's Encrypt)
4. **IMPORT_SECRET generieren** (32+ Zeichen)
5. **Rate Limiting aktivieren**
6. **Monitoring**: Logge alle Imports und Fehler
7. **User-Anleitung** im Frontend einblenden

## 📚 Weitere Services

- **[CloudMailin](https://www.cloudmailin.com)** - Empfohlen für kleine/mittlere Projekte
- **[SendGrid Inbound Parse](https://sendgrid.com/docs/for-developers/parsing-email/inbound-email/)** - Gut für große Projekte
- **[Mailgun Routes](https://www.mailgun.com/products/send/inbound-routing/)** - Flexibel, eigene Domain
- **[AWS SES](https://aws.amazon.com/ses/)** - Enterprise-Level
- **[Postmark Inbound](https://postmarkapp.com/inbound)** - Premium, sehr zuverlässig

---

**Das ist der einfachste Weg!** User klickt einfach "Weiterleiten" in der E-Mail-App → Flug wird automatisch importiert! 🚀
