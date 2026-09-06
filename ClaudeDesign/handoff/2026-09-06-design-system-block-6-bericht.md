# Block 6 — Reisen, Reisepass, Posteingang, Werkzeuge. Bericht (angefangen)

Zweig `dev/design-system`. Auftrag:
`ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md` §4, Block 6.

**Ein Punkt ist geliefert. Der Rest des Blocks ist nicht angefasst.**

---

## 1. Gebaut: zwei Dokumente, eine Papierfarbe

`components/FlightCertificate.tsx` trug eine **eigene sechswertige
Papierpalette** — ein Pergament `#f1e7cd`, zwei Tinten, ein Bronze, ein
Stempelrot — verwendet an 59 Stellen. Der Reisepass ist das **andere** Stück
Papier der Anwendung. Zwei Dokumente, zwei Papiere, keines davon das aus der
Tokendatei. Genau der Wunsch aus §7.7 der Runde-2-Rückmeldung.

Jetzt: `paper` und `paperText` aus `tokens.json`, die weicheren Töne als
**Alpha desselben Tinte** statt als zweite Farbe, Bronze = `accentPressed`
(die Marken-Bernstein-Schattierung, die auf hellem Papier lesbar ist),
Stempelrot = `bad`. Der siebte Hex — ein Hover-Ton — ist `accent`.

**Als literale Zeichenketten aufgelöst, nicht als `var(--ts-paper)`.** Die
Karte wird von html2canvas gerastert; einem Rasterisierer echte Werte statt
Custom Properties zu geben, entfernt eine ganze Fehlerklasse der Sorte
„sieht gut aus, exportiert leer". Einfach bezogen bleibt es trotzdem: die
Werte kommen aus dem generierten Tokenmodul, nicht aus dieser Datei.

**Der Hex-Ratchet ist zum ersten Mal geschrumpft**, von 81 Dateien auf 80.

---

## 2. Nicht gebaut

- **Der Reisepass als die eine helle Fläche.** Seine „Papierkarte" ist heute
  `--bg-elevated`, also dunkel — kein Papier. Ihn hell zu machen ist keine
  Änderung an einem Container, sondern an einer **ganzen Seite**: jedes Kind
  darin liest Farben aus dem dunklen Thema, und ein heller Container mit
  dunkel-thematisiertem Inhalt ist unlesbar. Das ist der größte Einzelposten
  des Blocks und der Signaturmoment, an dem er gemessen wird.
- **Stempelansicht und Druckansicht A4** nach `Druckansicht.dc.html`.
- **Posteingang mit den vier Leerzuständen** — das `EmptyState`-Primitiv steht
  seit Block 2 und hat hier seinen ersten echten Verbraucher.
- **Import-Logbuch als Seite**, **Schnellsuche ⌘K**, **Mitreisende-Verwaltung**,
  **Tag-Übersicht**, **Kopplungs-Moment**.
- **Entscheidung 13** — Mitreisende und Tags an allen vier Domänen. Der
  einzige Punkt des gesamten Auftrags, der das **Backend** berührt:
  `LodgingCompanion`, `PlaceVisitCompanion`, `tags` an `Lodging`/`Place`, per
  `prisma migrate dev`, mit `check:drift` grün. Nichts davon ist begonnen.

---

## 3. Bilder

`ClaudeDesign/screenshots/design-system/block-6/zertifikat-1440x900.png` —
das Flug-Zertifikat auf der Papierfarbe des Systems.

---

## 4. Gates

```
frontend  npx tsc --noEmit    → keine Ausgabe
frontend  npm run lint        → keine Ausgabe
frontend  npx vitest --run    → 431 Dateien, 3715 Tests, alle grün
frontend  npx vite build      → grün
```

Backend nicht berührt.

---

## 5. Nachtrag — Reisepass, Posteingang, und die Abnahme auf dem Beta-Server

### Der Reisepass IST jetzt die eine helle Fläche
Der größte Einzelposten aus §2 ist erledigt, und er war kleiner als gedacht.

Die Schwierigkeit war real: die Papierkarte enthält eine Ländertabelle und eine
Nachweis-Zusammenfassung, und **beide lesen `--text-muted`, `--border` und
`--bg-elevated` aus dem dunklen Thema**. Nur den Container hell zu machen
ergibt eine helle Kiste voll dunkel-thematisierten Textes.

Die Antwort ist, diese Namen **umzudefinieren** statt die Kiste anzustreichen.
`.ts-paper` in `theme/ui.css` richtet die acht Variablen, die dieser Teilbaum
liest, auf Papierwerte — alle aus `paper` und `paperText` abgeleitet, damit
Papier zwei Entscheidungen bleibt und nicht acht. Jedes Kind passt sich an,
ohne angefasst zu werden, auch ein Kind, das später dazukommt. Dafür sind
Custom Properties da; deshalb ist die Änderung eine Klasse und ein Wrapper
statt vierzig Einzelbearbeitungen.

Drei Links darin waren `text-blue-600 dark:text-blue-400` — eine
Tailwind-Palettenfarbe mit einem Hell-Modus-Zwilling, in einer Anwendung ohne
Hell-Modus. Sie lesen jetzt `--accent`, das `.ts-paper` auf den gedrückten
Bernstein umdefiniert.

**Drei Ratchets sind dadurch geschrumpft**: `dark:` von 18 auf 15 Dateien,
Tailwind-Palette von 83 auf 80, die Shell-Liste von 19 auf 18.

### Der Posteingang hat seinen ersten Leerzustand aus dem Primitiv
`PendingUpdatesPage` steht auf `AppShell` und benutzt `EmptyState` — mit der
Art **`pending`, nicht `nothing`**. Die Begründung steht im Code: die
Beschriftung ist bereits im Futur („Updates erscheinen hier, wenn …"), das ist
also kein „hier ist nichts", sondern „es ist noch nicht passiert". `nothing`
hätte dem Leser eine Handlungsaufforderung geschuldet; ein Wartezustand nicht,
weil der nächtliche Durchlauf ihn füllt. Die Shell-Liste geht damit auf 17.

### Abgenommen auf dem Beta-Server CT106
Auf Ansage des Owners auf **CT106** (`192.168.178.123:3010`) ausgerollt und
dort im Browser geprüft, gegen die **echten Beta-Daten**, nicht gegen den
lokalen Demo-Seed.

- Image: `ghcr.io/abrechen2/travstats:2.7.0-design.1`, lokal gebaut, nach GHCR
  gepusht. **`backend/VERSION` ist unberührt** (steht auf `2.6.1`) — die
  Fassung kam als `--build-arg`, damit der Tag nichts über einen Release
  behauptet.
- Gemessen auf dem laufenden Server: `body font-family` ist
  `"Hanken Grotesk", system-ui, …` (also die selbst gehostete Schrift, ohne
  Google-Fonts-Aufruf), `--ts-domain-cruise` ist `#4aa6b0`, **null
  Konsolenfehler** auf der Anmeldeseite.
- Bilder: `ClaudeDesign/screenshots/design-system/beta-ct106/`, je 1440×900 und
  390×844: Anmelden, Dashboard, Logbuch, Einstellungen, Reisepass, Posteingang.

**Was auf CT106 verändert wurde und wie man es zurückdreht:**

| Änderung | Rücknahme |
|---|---|
| `docker-compose.yml` zeigt auf `:2.7.0-design.1` statt `:2.6.0-rc.38` | Sicherung liegt daneben: `cp docker-compose.yml.bak-before-2.7.0-design.1 docker-compose.yml && docker compose up -d` |
| Passwort des Kontos `claude-uat` auf `DesignUAT2026!` gesetzt, `must_change_password` auf false | Nur dieses eine Konto; `admin`, `dennis`, `demo` und `flighttest` sind unberührt. Es gab keine hinterlegte Zugangsdatei für das Konto. |

Ein Befund vom echten Server, der lokal nicht auffiel: die **Anmeldeseite
läuft noch auf `--bg-base` `#0d1117`**, dem alten kühlen Grundton, weil sie
nicht auf `AppShell` steht. Sie ist in der Shell-Liste und fällt mit dem Rest.
