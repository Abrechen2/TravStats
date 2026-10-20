# Mail intake — booking mails arrive by themselves

Tracks `dennis/TravStats` forgejo#313, from the market analysis in forgejo#303. Branch
`docs/mail-intake-design`. **Status: draft, nothing decided.** The open decisions are in §9.

> A booking mail reaches TravStats without the user pasting it: forwarded to an address, or
> picked up from a mailbox folder. It lands in the inbox as a proposal with its original mail
> attached, and becomes an entry only when the user confirms.

**Not this:** connecting Gmail or Outlook through OAuth (high effort, verified-app review, see
§8), and sending mail (reminders and invitations already go out through `nodemailer`).

---

## 1. Why

TripIt, Flighty, byAir and Surmai all let the user forward booking mails. TravStats already
does the hard half: `POST /parse-email` reads flights, cruises, stays and rail from a mail,
with templates, the LLM chain and `domain: 'auto'` detection, and `parseRetention` keeps the
mail as a `Document` (`format: eml`). What is missing is the way in. Today every mail is
copied by hand, which is exactly the step people skip — and a booking that is never entered
is a statistic that is quietly wrong.

## 2. What already exists, and is reused unchanged

| Piece | Where | Role here |
|---|---|---|
| Mail parsing, auto domain | `routes/emailParse.ts`, `services/emailExtractor.ts`, `services/cruiseBookingParser.ts` | Parses the fetched mail. The intake calls the same service functions, not the HTTP route. |
| MIME reading | `services/email/mimeMessage.ts`, `services/documents/emlPreview.ts` | Subject, HTML part and send date out of an `.eml`. The send date is the `referenceDate` (#285). |
| PDF attachments | `services/parsers/pdfAttachmentFlights.ts`, `routes/pdfParse.ts` | A booking that is only in the attached PDF. |
| Kept originals | `Document` (`source`, `format`, `parsedDomain`, `parsedPayload`, `unlinkedAt`) | Every fetched mail is stored as a `Document`, so the original stays attached to the entry it becomes (owner rule: attach the original). |
| Unfiled documents + sweep | `UnfiledDocumentsSection.tsx`, hourly sweep, 30-day TTL | A mail that produced nothing usable is not lost silently: it is an unfiled document with its deletion date shown. |
| Secret storage | `utils/encryption.ts` | IMAP passwords are stored encrypted, as API keys are. |
| Jobs | `services/jobs/jobRegistry.ts` | The poller is a job with a status the UI can read. |

## 3. The three ways in

### A. IMAP pickup from a personal folder (per user)

The user enters the IMAP host, port, user name, password (an app password for Gmail,
iCloud, Outlook and GMX) and **one folder**, for example `TravStats`. A mail filter or a
manual move puts bookings into it. TravStats reads that folder and nothing else.

- Works on every self-hosted instance: no DNS, no open port, no third party.
- Only the folder is read. The rest of the mailbox is never listed or opened.
- After processing, the mail is flagged `\Seen` and gets the keyword `$TravStats` (or is
  moved to `TravStats/Erledigt`). It is never deleted.

### B. Forwarding address through one instance mailbox (admin)

The admin connects **one** mailbox for the instance (for example `trips@example.org`) under
Administration → Instance. Each user gets a personal address with plus addressing:
`trips+k7m2q9xw@example.org`. The user forwards bookings there, or sets an automatic
forwarding rule in the mail program.

- This is the "forwarding address" of TripIt, without TravStats running a mail server.
  The mail provider receives, TravStats only reads by IMAP.
- The token after `+` is random, per user, and can be regenerated. Mail to an unknown or
  revoked token is rejected (see §5), never guessed into an account.
- Requires a provider that supports plus addressing (most do: Gmail, Fastmail, Mailbox.org,
  Posteo, iCloud with a custom domain, mailcow, Stalwart). A catch-all domain
  (`k7m2q9xw@trips.example.org`) is the alternative for providers that do not.

### C. Inbound webhook (later, optional)

`POST /api/v1/mail-intake/inbound` with a signed body, for Cloudflare Email Workers, Mailgun
Routes or Postmark Inbound. Useful for instances already behind Cloudflare. **Not in the first
cut:** it needs a public instance and a per-provider signature check, and A plus B cover
every self-hoster without them.

### Not D: a built-in SMTP receiver

Port 25 open to the internet, an MX record, TLS, spam and backscatter for a homelab
container. Rejected.

## 4. Pipeline

```
fetch (IMAP, every N min + IDLE where supported)
  → dedupe by Message-ID (+ IMAP UID/UIDVALIDITY)        — idempotent, a re-run creates nothing
  → authorise the sender (§5)                             — rejected mail: logged, never parsed
  → store the raw .eml as a Document (source: "mail")     — original kept, sweep clock starts
  → parse: auto domain, referenceDate = mail date, PDF attachments too
  → result:
      booking found     → inbox proposal "Neuer Eintrag aus Mail" with a preview
      change/cancel     → proposal on the EXISTING entry (booking reference match)
      duplicate         → linked to the existing entry, shown as "already there"
      nothing usable    → stays an unfiled document, with the reason
      parser failed     → inbox item with the failure reason, retry button
  → user confirms → entry created, document filed with it (linkedAt set)
```

- **No entry without confirmation** in the first cut. An "auto-create when the template
  matched with full confidence" switch can come later, once the proposals are trusted.
- Every failure has its own reason and reaches the inbox: connection refused, auth failed,
  folder missing, TLS error, mail too large, parser timeout, LLM not allowed. A poller that
  fails is a red status in the settings card with the last error and its time — not a log line
  (silent-failure class 3).
- The LLM chain is used only as configured today. Cloud providers only with the existing
  consent: a booking mail is personal data.
- Limits: max mail size (as the document upload limit), max mails per run, per-user rate.

## 5. Security

The address and the folder are input from outside. Whoever can put a mail there can put a
proposal into the inbox. Proposals are harmless until confirmed, but:

1. **Allowed senders (mode B).** A user lists the addresses they forward from. Mail from
   other senders to their token is rejected. Forwarded mail is judged by the envelope/`From`
   of the forwarding account, not the airline's address inside it. Unknown sender → an inbox
   note "Mail von x@y abgelehnt" with an "allow this sender" button.
2. **SPF/DKIM/DMARC result** from `Authentication-Results` of the receiving provider is read
   and stored. A failed DMARC on an allowed sender is rejected. Provider-written headers only
   — a header the sender wrote is not evidence.
3. **Tokens** are stored as a hash (as share-link tokens are), regenerable, revocable.
4. **IMAP credentials** encrypted at rest, TLS required (STARTTLS or implicit). Plain IMAP
   only behind an explicit admin switch for a LAN mail server.
5. **No egress restriction on the IMAP host**, as with Immich: a self-hosted mail server lives
   on the LAN. Same note as for Immich in `CLAUDE.md`.
6. **HTML is never rendered** from a fetched mail into the app. Text extraction only, as the
   parser does today.
7. **Account deletion** removes the IMAP settings, the token and every stored mail.
   **Backup** includes the settings without the password (the user enters it again after a
   restore), or encrypted with the instance key — to be decided (§9).

## 6. Data model (sketch)

- `MailIntakeSource`: `id`, `userId` (null = instance mailbox), `kind` (`imap_folder` |
  `instance_mailbox`), host, port, tls mode, username, encrypted password, folder,
  `enabled`, `lastRunAt`, `lastOkAt`, `lastError`, `lastErrorAt`, `uidValidity`, `lastUid`.
- `MailIntakeAddress`: `userId`, token hash, `createdAt`, `revokedAt`.
- `MailIntakeSender`: `userId`, address, `allowedAt`.
- `MailIntakeMessage`: `sourceId`, `messageId`, `uid`, `receivedAt`, `documentId`,
  `status` (`proposed` | `filed` | `duplicate` | `nothing` | `rejected` | `failed`),
  `reason`. Unique on (`sourceId`, `messageId`). This is the idempotency key and the audit.

## 7. UI

- **Settings → Import → "Buchungsmails automatisch einlesen"**: the personal address with a
  copy button (mode B, when the admin set it up), or the IMAP folder form (mode A); allowed
  senders; status line "Zuletzt geprüft 14:05 · 2 neue Vorschläge" or the last error in plain
  words; "Jetzt prüfen".
- **Administration → Instanz**: the instance mailbox for mode B, with a test button.
- **Posteingang**: a new card kind "Aus deiner Mail" — sender, subject, date, what was found,
  the parsed preview, [Übernehmen] [Bearbeiten] [Verwerfen]. Discarding keeps the mail as an
  unfiled document until the sweep.
- Companion: the inbox there shows the same proposals (later; the API is the same).
- DE first, EN mirrored. Behind a beta key until it has run on prod for a release.

## 8. Why not OAuth (Gmail/Outlook) now

Reading Gmail through its API needs a Google Cloud project per instance, the restricted
`gmail.readonly` scope and, for anything beyond test users, a security assessment. Every
self-hoster would have to create their own project. Mode A with an app password reaches the
same mailbox for a fraction of the effort. OAuth stays an idea in forgejo#303.

## 9. Open decisions for the owner

1. **Order:** mode A (personal folder) first, mode B (forwarding address) first, or both in
   the first cut? Proposal: **both**. B is what users know from TripIt; A is what works when the
   admin set up nothing. They share the whole pipeline; only the fetch differs.
2. **Auto-create:** only proposals in the first cut (proposal), or create directly when a
   template matched with full confidence?
3. **Processed mail in the folder:** flag + keyword (proposal), or move to a subfolder?
4. **Backup of IMAP passwords:** left out (user re-enters after restore — proposal), or
   included encrypted with the instance key?
5. **Webhook (mode C)** for Cloudflare Email Workers: later (proposal), or in the first cut
   because prod sits behind Cloudflare?
6. **Polling interval:** 5 minutes plus IDLE (proposal).

## 10. Build order once decided

1. Data model + migration, encrypted credentials, token/sender tables.
2. Fetcher (IMAP, `imapflow`) as a job with status; dedupe; tests against a local IMAP server
   in a container (GreenMail or Dovecot) for success and each failure kind.
3. Pipeline: store `.eml` as Document, parse, classify result, inbox proposal.
4. Settings + admin UI, inbox card, DE/EN.
5. Security checks: allowed senders, Authentication-Results, token revoke.
6. Browser check of the golden path and of each failure reaching the inbox.
