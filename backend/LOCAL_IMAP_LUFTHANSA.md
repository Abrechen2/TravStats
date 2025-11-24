# Lokaler IMAP-Import für Lufthansa-Buchungsmails (IONOS Beispiel)

Diese Anleitung zeigt, wie du den IMAP-Poller so konfigurierst, dass **nur Lufthansa-Buchungsbestätigungen** aus deinem IONOS-Postfach eingelesen werden – ohne externe Cloud-Dienste.

## 1) Voraussetzungen
- Lauferender Backend-Server (Prisma-DB eingerichtet).
- Zugriffsdaten für dein IONOS-Mailkonto (IMAP-User/Passwort).
- Deine `userId` aus der Datenbank (siehe unten).

## 2) User-ID herausfinden
```bash
cd backend
npx ts-node -e "import { prisma } from './src/db'; prisma.user.findMany().then(u => {u.forEach(x=>console.log(x.email, x.id)); process.exit(0);});"
```
Kopiere die passende `id` und setze sie gleich als `IMAP_DEFAULT_USER_ID`.

## 3) .env konfigurieren (nur relevante Werte)
In `backend/.env`:
```
IMAP_ENABLED=true
IMAP_HOST=imap.ionos.de
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=<deine IONOS Mail>
IMAP_PASSWORD=<dein IMAP-Passwort>
IMAP_DEFAULT_USER_ID=<deine User-ID>
# optional: eigener Ordner, z.B. INBOX/Bookings
IMAP_MAILBOX=INBOX
# Filter auf Lufthansa
IMAP_ALLOWED_SENDERS=@lufthansa.com,@dlh.de,@mail.lufthansa.com
IMAP_SUBJECT_KEYWORDS=lufthansa,buchungsbestaetigung,booking,etix,eticket
```
Hinweis: Für engere Filter kannst du Absender/Keywords anpassen oder einen separaten Ordner nutzen und per Mail-Regel dorthin verschieben.

## 4) Poller starten
```bash
cd backend
npx ts-node src/services/runImapPoller.ts
```
Die Logs zeigen Host, User, Poll-Intervall, Mailbox sowie die aktiven Filter.

## 5) Funktionsweise (aktuelle Implementierung)
- Verbindet sich auf `IMAP_MAILBOX` (Default `INBOX`).
- Sucht **nur ungelesene** Mails (`UNSEEN`), optional direkt nach Absender gefiltert.
- Prüft zusätzlich Betreff auf Keywords (Default: Lufthansa/Booking).
- Parst passende Mails (`parseBookingEmail`) und legt einen `importedFlight` mit Status `pending_review` an.
- Markiert verarbeitete Mails als `\Seen`.

## 6) Review im Frontend
Dashboard öffnen → Button/Badge „Imports“ → den neuen Eintrag ansehen → „Übernehmen“ oder „Verwerfen“. Nach „Übernehmen“ erscheint der Flug in Liste/Karte.

## 7) Troubleshooting
- Keine Imports? Checke:
  - Sind die Mails ungelesen?
  - Absender/Betreff decken sich mit den Filtern?
  - IMAP_HOST/PORT/SECURE korrekt für IONOS (993 + TLS)?
  - Logs des Pollers auf Fehler.
- Zu viele Mails? Engere Filter setzen oder eigenen Ordner nutzen und nur dort pollen.
- Andere Airlines? Ergänze `IMAP_ALLOWED_SENDERS` / `IMAP_SUBJECT_KEYWORDS` entsprechend.
