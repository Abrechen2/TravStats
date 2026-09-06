# Designsystem im Web — Stand 06.09.2026

Die Übergabenotiz für diesen Auftrag. Sie liegt **im Repo** und nicht in
`/home/claude/UEBERGABE.md`, weil diese Datei am 06.09. um 12:15 von einer
parallelen Sitzung auf dem PC überschrieben wurde, während hier gearbeitet
wurde — eine Datei, die zwei Rechner gleichzeitig schreiben, ist keine
Übergabe. Hier kann sie nur per Commit verschwinden.

Auftrag: `ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md`.
Sieben Blöcke: **drei fertig, vier teilweise.**

## Stand

- Worktree `/home/claude/projekte/TravStats/.worktrees/design-system`
- Zweig `dev/design-system`, Spitze **`8394ba53`**, auf **forgejo** und
  **github**. **Nicht** nach `main` oder `dev/v2.7` gemergt — Owner-Entscheidung.
- Gates (echte Exit-Codes): frontend tsc 0, lint 0, vitest 0
  (**3715 Tests in 431 Dateien**), `check:size` 0, prettier 0, `vite build` 0;
  backend tsc 0, lint 0.

| Block | Stand | Bericht |
|---|---|---|
| 1 Fundament | **fertig** | `…-block-1-bericht.md` |
| 2 Primitive | **fertig** | `…-block-2-bericht.md` |
| 3 Logbuch-Familie | teilweise — Zeilen noch nicht auf `Table`, sechs Detailseiten offen | `…-block-3-bericht.md` |
| 4 Dashboard und Karten | Kern fertig — Karte und Legende stimmen; Kopfleiste, Globus, mobiles Sheet offen | `…-block-4-bericht.md` |
| 5 Statistik, Erfolge | teilweise — **Jahresrückblick `/review/:year` nicht gebaut** | `…-block-5-bericht.md` |
| 6 Reisen, Reisepass, Werkzeuge | teilweise — Reisepass IST Papier, Posteingang auf `EmptyState`; Reisen/Werkzeuge offen | `…-block-6-bericht.md` |
| 7 Aufräumen und Wächter | **Wächter fertig**, Aufräumen eingefroren | `…-block-7-bericht.md` |

## ⚠ Auf CT106 (Beta) läuft der Design-Build

Am 06.09. **auf ausdrückliche Ansage des Owners** („zum testen kannst bitte den
BETA Server hernehmen CT106") dorthin ausgerollt und im Browser abgenommen,
gegen die echten Beta-Daten.

> **Achtung, widersprüchliche Notiz:** die PC-Übergabe von 12:15 schreibt
> „CT106 (Beta) grundsätzlich nicht anfassen". Sie entstand nach dem Deploy
> (11:42) und ohne Kenntnis der Ansage. Die Ansage ist die jüngere Information;
> die Regel als Dauerregel bleibt richtig.

- Läuft: `ghcr.io/abrechen2/travstats:2.7.0-design.1`, vorher `:2.6.0-rc.38`.
  **`backend/VERSION` ist unberührt** (2.6.1) — die Fassung kam als
  `--build-arg`, damit der Tag nichts über einen Release behauptet.
- **Zurückdrehen, ein Befehl:**
  ```bash
  ssh -i ~/.ssh/id_ed25519 root@192.168.178.180 "pct exec 106 -- bash -c '
    cd /opt/travstats-beta &&
    cp docker-compose.yml.bak-before-2.7.0-design.1 docker-compose.yml &&
    docker compose up -d'"
  ```
- **Login dort:** `claude-uat` / `DesignUAT2026!` — das Passwort dieses **einen**
  Kontos wurde gesetzt, weil keine Zugangsdatei existierte. `admin`, `dennis`,
  `demo`, `flighttest` unberührt.
- Bilder: `ClaudeDesign/screenshots/design-system/beta-ct106/`.
- Auf dem Server gemessen: Hanken Grotesk lädt selbst gehostet (kein
  Google-Fonts-Aufruf), `--ts-domain-cruise` = `#4aa6b0`, null Konsolenfehler.

## Was steht

- **Tokengenerator** `design/tokens.json` → `theme/tokens.css` **und**
  `theme/tokens.ts` (`npm run tokens`). Das TS-Modul gibt es, weil deck.gl und
  der Globus in eine Leinwand malen und keine Custom Property lesen können.
- **Schriften selbst gehostet** (`npm run fonts`); Syne und Inter gefallen.
- **`AppShell`** (drei Breiten), **`PageHeader`**, `components/ui/` mit
  14 Primitiven, Abnahmefläche **`/design`** (nur Dev-Build).
- **Einstellungen als Routen pro Gruppe**; jede alte `?section=`-URL löst auf.
- **Domänenfarben = Companion-Werte**; Touren haben **eine** Farbe.
- **Eine Statuspille** überall; **eine Papierfarbe** für Reisepass und
  Flug-Zertifikat; **eine Farbpalette** statt sechs.

## Die Wächter — sie messen, was noch fehlt

Jeder scheitert an einem **neuen** Eintrag *und* an einem **veralteten**, kann
also nur schrumpfen.

| Test | misst | Stand |
|---|---|---|
| `theme/__tests__/tokens.generated.test.ts` | Generatorausgabe = Tokendatei (CSS + TS) | absolut, grün |
| `__tests__/designWardens.test.ts` | Hex-Literale | **80** Dateien |
| — | rohe Tailwind-Palettenklassen | **80** Dateien |
| — | `dark:`-Varianten | **15** Dateien |
| — | eigene `fixed inset-0`-Overlays | **44** Dateien |
| — | jede gelesene CSS-Variable ist definiert | absolut, grün |
| `__tests__/appShell.ratchet.test.ts` | Seiten, die ihre Shell selbst bauen | **17** Seiten |
| `__tests__/screenTitle.test.ts` | jede `<h1>` ist `.t-screen-title` | absolut, grün |
| `components/ui/__tests__/primitives.test.tsx` | kein Hex in `components/ui/` | absolut, grün |

## WICHTIG: die Companion-Tokendatei liegt auf einem ungepushten Zweig

`/home/claude/projekte/TravStatsCompanion`, Zweig
**`design/tokens-tour-motion`**, Commit `63aa4fe`: `domainColor.tour`, der
`motion`-Block, dazu das nachgezogene `app/src/theme/tokens.ts`. **Nicht
gepusht, nicht nach main gemergt.** `design/tokens.json` hier ist die Kopie
davon. Wer den Companion-Zweig verwirft, muss auch diese Kopie zurückdrehen.

## Weiter mit

1. **Entscheidung 13** — Mitreisende und Tags an allen vier Domänen. Der
   einzige Punkt des Auftrags, der das **Backend** berührt
   (`LodgingCompanion`, `PlaceVisitCompanion`, `tags` an `Lodging`/`Place`,
   `prisma migrate dev`, `check:drift` grün) und der mit der längsten Laufzeit.
2. **Jahresrückblick `/review/:year`** (Block 5) — neue Seite mit eigenen
   Abfragen nach `Jahresrueckblick.dc.html`.
3. **Kopfleiste** nach dem Export (56 px, Suchpille ⌘K, „Mehr"-Menü,
   Avatar-Menü). Die Primitive stehen seit Block 2; der Umbau berührt jede Seite.
4. **`DashboardLayout`** braucht vermutlich eine **dritte Shell-Bauform**
   (randlos, nicht scrollend): es ist ein `height: 100vh`-Flexlayout mit
   `overflow: hidden`, `AppShell` bringt `min-h-screen` und Polsterung mit. Das
   ist eine Frage an das Primitiv, kein mechanischer Umbau.
5. **Block 3s Rest** und **Block 7s Aufräumen** — die Wächter zeigen nach jedem
   Schritt, was übrig ist.

**Muster, das sich bewährt hat:** `.ts-paper` in `theme/ui.css` themt eine
Fläche um, ohne ein einziges Kind anzufassen — es definiert die acht
Variablen um, die der Teilbaum liest. Dasselbe trägt für die Druckansicht A4.

## Zwei Entscheidungen, die der Owner sehen soll

- **`in_progress` und `historical` haben ihre eigene Farbe verloren.**
  `DESIGN_SYSTEM.md` §2.6 bildet „läuft gerade" auf die Geflogen-Farbe ab und
  macht „historisch" grau statt bernstein. Beide überstimmen eine frühere, gut
  begründete lokale Entscheidung.
- **Ein geplanter Flug und eine geplante Kreuzfahrt sind auf der Karte dasselbe
  Blau** (`info`), wo sie Koralle und Zyan waren. Der Preis dafür, „geplant"
  mit einer Farbe zu sagen — derselbe Handel wie in der Statuspille. Es sind
  Voreinstellungen, keine Sperren.

## Fallen, die Zeit gekostet haben

- **Gate-Kommandos nie durch `tail` pipen** — die Shell meldet dann den
  Exit-Code von `tail`, und eine `&&`-Kette läuft an einem roten Gate vorbei.
  Genau so ging ein `check:size`-Fehler raus (`acd292c3` zog ihn nach).
- **Prettier kann eine Datei über ihre Größen-Baseline heben.** Nicht die
  Baseline anheben — auslagern.
- **Kein `prettier --write` über den ganzen Baum** (~189 Dateien sind nie
  formatiert worden), aber **die eigenen wirklich**: sobald man eine solche
  Datei anfasst, prüft CI sie.
- `theme/tokens.css`, `tokens.ts`, `fonts.css` stehen in `.prettierignore` —
  Generatorausgaben.
- Für den lokalen Stack: **`CORS_ORIGIN` explizit setzen** (Default ist nur
  `:3000`), im Browser `localhost` statt `127.0.0.1`, und `/design` gibt es nur
  im Dev-Build.
