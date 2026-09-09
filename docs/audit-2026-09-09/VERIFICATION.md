# Gegenprüfung der Befunde AUD-001 bis AUD-011

Zweite Instanz (Claude), 09.09.2026, gegen `2f89bfd1` auf `main`. Codex' Audit
läuft parallel weiter; diese Datei ist die Antwort darauf und ersetzt
`FINDINGS.md` nicht.

**Methode:** jeder Befund wurde an der genannten Quellstelle nachgelesen, nicht
aus der Beschreibung übernommen. Wo ein Befund eine Aussage der Projektregeln
berührt, ist auch die Regel geprüft worden. Es wurde keine Laufzeitprobe von
Codex wiederholt — die dort dokumentierten Reproduktionen sind schlüssig und
die statische Kette allein trägt jeden dieser elf Punkte.

**Ergebnis: alle elf bestätigt.** Kein Fehlalarm, keine Fehllesung, keine
Absicht, die als Fehler gelesen worden wäre.

| ID | Urteil | Belegstelle, an der die Gegenprüfung hängt |
|---|---|---|
| AUD-001 | bestätigt | `jest.globalSetup.ts` prüft nur Existenz der Variable und `SELECT 1`; keine Namens-/Markerprüfung, keine getrennte `TEST_DATABASE_URL`. Suiten rufen `user.deleteMany()` ungefiltert. |
| AUD-002 | bestätigt | `requireWriteScope` kommt in `routes/auth/twoFactor.ts`, `routes/auth/passkeys.ts` und in den Mounts **null**-mal vor. |
| AUD-003 | bestätigt | `utils/jwt.ts` signiert ausschliesslich `{ userId }`. Kein Feld, das gegen den Benutzerzustand geprüft würde. |
| AUD-004 | bestätigt | `routes/auth.ts` liest `userCount`/`isFirstUser`/`maxUsers` **vor** `prisma.$transaction`. Der Kommentar darüber behauptet, die Serializable-Transaktion verhindere genau diese Konkurrenz — sie kann es nicht, weil der Lesevorgang ausserhalb liegt. |
| AUD-005 | bestätigt | siehe unten, ausführlich. |
| AUD-006 | bestätigt | `backupFiles.ts` schreibt Einträge als `uploads/<dir>/…`; `backupRestore.ts` entpackt mit `-C <backend>/uploads`. Ergebnis `uploads/uploads/<dir>/…`. |
| AUD-007 | bestätigt | `spawnRestore(..., 'psql', ...)` ohne `-v ON_ERROR_STOP=1` und ohne `--single-transaction`; der Dump ist `-F p` ohne `--clean`. |
| AUD-008 | bestätigt | `restoreBackupSchema` kennt nur `scope` und `createBackupBefore`. Zod entfernt `targetDatabaseUrl`, deshalb ist `options.targetDatabaseUrl` in `backupRestore.ts:77` immer `undefined` und der Fallback auf `DATABASE_URL` greift immer. Das Frontend sendet das Feld trotzdem. |
| AUD-009 | bestätigt | Das Archiv enthält exakt `database.sql`, `uploads.tar.gz`, `metadata.json`. Der Schlüssel liegt ausserhalb. |
| AUD-010 | bestätigt | Der Ausführungspfad des Schedulers ruft `createBackup({ type: 'full' })` und sonst nichts. `cleanupOldBackups` und `syncToCloud` kommen dort nicht vor. |
| AUD-011 | bestätigt | Das `onChange` verlässt die Funktion per `return`, solange `new URL(...)` wirft. Das erste Zeichen wirft immer, also kann das leere Feld nie befüllt werden. |

## AUD-005 im Einzelnen, weil er einer Projektregel zu widersprechen scheint

CLAUDE.md führt unter den maschinell gehaltenen Regeln: „2FA is asked before a
forced password change", gehalten von
`backend/src/routes/__tests__/twoFactor.login.test.ts`. Das klingt, als sei
AUD-005 damit abgedeckt. Es ist es nicht, und der Unterschied ist genau der
Befund:

- Die Regel und ihr Test betreffen die **Reihenfolge der Zweige im
  Login-Handler**: der 2FA-Zweig muss über dem `mustChangePassword`-Zweig
  stehen, weil ein Konto mit beiden Merkmalen sonst allein auf das Passwort hin
  ein `change_token` bekäme — und `force-change-password` verlangt nur dieses
  Cookie. Diese Reihenfolge ist eingehalten, der Test prüft sie, und der Test
  ist echt.
- AUD-005 betrifft, was **danach** passiert. `/2fa/verify` ruft nach der
  verbrannten Challenge `issueAuthCookie(req, res, user)` **bedingungslos** auf
  und liest `user.mustChangePassword` nie. Das erzwungene Passwort ist damit für
  jedes 2FA-Konto wirkungslos.

Dass es ein Versehen ist und keine Abwägung, steht im Nachbarpfad:
`routes/auth/passkeys.ts` prüft die Bedingung ausdrücklich, mit einem Kommentar,
der sie begründet — „a user owing a password change must still be sent through
that flow". Zwei Anmeldewege, dieselbe Frage, zwei verschiedene Antworten.

**Anmerkung zur Regelliste:** die Zeile in CLAUDE.md ist nicht falsch, aber sie
liest sich weiter, als sie trägt. Ein Wächter, der die Reihenfolge zweier
Zweige festhält, sagt nichts darüber, ob die zweite Tür dieselbe Bedingung
kennt. Nach der Behebung sollte die Zeile das benennen.

## Was daraus folgt, wenn es behoben wird

Zwei Punkte, die aus den Befunden allein nicht hervorgehen und beim Beheben
zählen:

1. **AUD-005 ist nicht rein serverseitig.** `frontend/src/lib/api/auth.ts`
   typisiert `verifyTwoFactor` als `Promise<{ user: User }>`. Gibt der Server
   künftig `{ requiresPasswordChange: true }` zurück, läuft die 2FA-Seite in
   einen Zustand ohne Benutzer, statt zum Passwortwechsel zu führen. Die
   Behebung umfasst Rückgabetyp und Verzweigung im Frontend.
2. **AUD-009 ist keine reine Auslassung, sondern eine Abwägung.** Den
   Verschlüsselungsschlüssel ins Archiv zu legen macht jedes Backup zu einem
   Geheimnis, das nicht mehr unverschlüsselt liegen darf — und die
   WebDAV-Synchronisation trüge es dann automatisch nach aussen. Die Behebung
   ist deshalb eine Entscheidung des Betreibers (Schlüssel getrennt sichern,
   mit deutlicher Warnung in der Oberfläche) und keine Zeile Code.

## Status der Behebungen

Stand 09.09.2026, Zweig `fix/audit-2026-09-09`. Jede Behebung trägt eine Prüfung,
die ohne sie rot wird — wo das nachgewiesen wurde, steht es in der letzten Spalte.

| ID | Behebung | Gegenprobe |
|---|---|---|
| AUD-001 | `jest.globalSetup.ts` verweigert den Dienst bei entferntem Host (ohne Ausweg) und bei einer lokalen Datenbank, die nicht als wegwerfbar erkennbar ist (`TRAVSTATS_ALLOW_DESTRUCTIVE_TESTS=1` als bewusster Ausweg). | Beide Sperren gegen eine Prod-Adresse und gegen `localhost/flights` ausgelöst; `_test`-Name kommt durch. |
| AUD-002 | Neue Middleware `requireBrowserSession` (`middleware/auth.ts`) an allen mutierenden 2FA- und Passkey-Routen. Das Muster gab es zweimal von Hand (Kopplung, PAT-Verwaltung) — jetzt an einer Stelle. | `accountSecurity.browserOnly.test.ts`: ohne den Guard fallen 6 von 7 Fällen. |
| AUD-003 | Neue Spalte `sessionEpoch` (Migration `20260909201004_add_session_epoch`), im JWT mitgeführt, in `authenticate` geprüft; jeder der vier Passwort-Schreibpfade zählt hoch. Der eigene Wechsel bekommt ein frisches Cookie. | `sessionRevocation.test.ts`, vier Fälle. Ein Zeitstempel statt eines Zählers scheiterte nachweislich an der Sekundenauflösung von `iat` — deshalb ein Zähler. |
| AUD-004 | Zählung und Schreiben in EINER Transaktion, dazu `takeUserCountLock` (`utils/userCountLock.ts`) in Registrierung, Setup und Admin-Anlage. | `register.concurrency.test.ts`: mit der Zählung in der Transaktion, aber ohne Lock, kamen weiterhin vier Admins heraus — Serializable allein genügte hier gemessen NICHT. |
| AUD-005 | `/2fa/verify` prüft `mustChangePassword` und gibt die Wechsel-Aufforderung statt einer Sitzung aus; gemeinsamer Helfer `issuePasswordChangeChallenge`. Frontend: Rückgabetyp geweitet, 2FA-Seite verzweigt. | Backend- und Frontend-Test; ohne den Fix liefert `/2fa/verify` das Benutzerobjekt. |
| AUD-006 | Entpacken ins ELTERNverzeichnis von `uploads` (`extractUploadsArchive`), damit vorhandene Archive weiter wiederherstellbar bleiben. tar-Fehlermeldung wird jetzt zitiert. | Auf Linux gemessen: mit dem Fix liegt die Datei richtig und nicht doppelt, mit dem alten Ziel genau umgekehrt. Der Test überspringt Windows mit Begründung (GNU tar liest `C:` als Rechnernamen). |
| AUD-007 | `psql` läuft mit `ON_ERROR_STOP=1` und `--single-transaction`; alle fünf `pg_dump`-Aufrufe schreiben `--clean --if-exists`. | Ein Restore über veränderte Daten schlägt jetzt fehl, statt Erfolg zu melden und nichts zu tun. |
| AUD-008 | Das Feld, das der Server nie sah, ist aus Oberfläche, API-Client und DE/EN-Kopie entfernt; im Service steht, was eine künftige Oberfläche dafür mitbringen müsste. | — (Entfernung) |
| AUD-011 | entfällt mit AUD-008: das Eingabefeld, das sich nicht tippen liess, gibt es nicht mehr. | — |

**Nicht behoben, mit Absicht:**

- **AUD-009** (Schlüssel nicht im Backup) ist eine Betreiber-Entscheidung, keine
  Zeile Code: den Schlüssel ins Archiv zu legen macht jedes Backup zum Geheimnis,
  das die WebDAV-Synchronisation dann automatisch nach aussen trägt.
- **AUD-010** (Zeitplan räumt nicht auf, synchronisiert nicht) ist eine fehlende
  Funktion. Sie zu bauen wäre ein `feat:` und hebt die nächste Version auf 2.7.0
  statt 2.6.3.
- **AUD-012 bis AUD-027** kamen während dieser Runde dazu und sind nicht geprüft.
  Die dringendste davon ist **AUD-019** (eine selbst angelegte Belegreferenz
  öffnet fremde Uploads): sie braucht einen echten Eigentümer an der
  Upload-Ressource, also eine eigene Tabelle — eine eigene Runde wert.
