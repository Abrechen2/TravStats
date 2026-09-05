# Auftrag an CT142 — Designsystem im Web umsetzen (2.7.0)

Owner-Ansage 05.09.2026, spät: „Können wir das CT142 in Auftrag geben in einem
Worktree, dann kann er alles selber zum Laufen bringen? Mit dem neuen Design,
ohne Nachfragen, alles selber entscheiden, mit Fable."

Das ist der Auftrag. Er ist so geschrieben, dass eine Sitzung auf CT142 ihn
liest und ohne Rückfrage arbeitet. Wo etwas offen ist, steht hier, wie zu
entscheiden ist. Wo etwas verboten ist, steht es unter „Nicht tun".

---

## 0. In einem Satz

Das Web (`frontend/`) wird auf das Companion-Designsystem umgestellt, nach dem
Zielbild des Claude-Design-Exports (Runde 3, 48 Screens) und den dreizehn
Entscheidungen des Owners — in sieben Blöcken, jeder mit einem prüfbaren
Ergebnis, auf dem Zweig `dev/design-system` in einem eigenen Worktree.

## 1. Was zu lesen ist, in dieser Reihenfolge

| Datei | Wozu |
|---|---|
| `CLAUDE.md` | Regeln des Repos, Gates, Invarianten. Gilt vollständig. |
| `design/DESIGN_SYSTEM.md` | Das Designsystem in der Web-Lesart: Tokens, drei Breiten, Primitive, Regeln. |
| `design/tokens.json` | Die Wahrheit für Farbe, Schrift, Radius, Maß. Spiegel der Companion-Datei. |
| `ClaudeDesign/handoff/2026-09-05-web-vereinheitlichung.md` | Die ursprüngliche Übergabe: Messung des Ist-Zustands (Anhang A), die sieben Blöcke (§4), Abnahmekriterien (§5). |
| `ClaudeDesign/handoff/2026-09-05-web-redesign-rueckmeldung.md` | Rückmeldung auf Runde 1 mit den Korrekturen (§2), Lückenlisten (§3–§6) und **§9: die dreizehn Owner-Entscheidungen mit Antwort**. §9 ist bindend. |
| `ClaudeDesign/export/2026-09-05-runde-3/` | Das Zielbild: 48 `*.dc.html`-Screens (offline im Browser lauffähig, `Index.dc.html` als Einstieg), `ts-shared.js` (Tokens `T`, `STATUS`, `DOMAINS`, `NAV`, `BETA`, `MONO_KEYS`, Lucide-Sprite), `MOTION.md`, `antwort-runde-2.md`, `antwort-runde-3.md`. |
| `frontend/src/config/betaFeatures.ts` | Das Beta-Register. Eine Plakette im Web gibt es genau dort, wo hier ein Schlüssel steht. |

Der Export ist Referenz, nicht Code. Nichts daraus wird kopiert; jedes Primitiv
wird in React neu geschrieben und liest ausschließlich Tokens.

## 2. Arbeitsort und Zweig

```bash
cd /home/claude/projekte/TravStats
git fetch forgejo --prune
git worktree add .worktrees/design-system -b dev/design-system forgejo/dev/v2.7
cd .worktrees/design-system
(cd backend && npm ci) && (cd frontend && npm ci) && npm ci
```

- **Basis ist `dev/v2.7`**, nicht `main`. Dort liegen die 2.7-Arbeiten (Reisepass
  und Orte aus der Beta, Parser hinein, Orte-CSV-Import, KI-Zusammenfassung,
  Parser-Vorlagen). Beide Zweige zielen auf 2.7.0.
- **Regelmäßig `forgejo/dev/v2.7` hineinmergen** (nach jedem Block), niemals
  rebasen. Konflikte klein halten.
- **Echte `node_modules`**, keine Junctions oder Symlinks in den Hauptbaum —
  Vite und tsc brechen daran, und `git worktree remove` löscht durch sie
  hindurch.
- **Remotes auf CT142: `forgejo` und `github`, nie `origin`.** `origin` heißt
  dort Forgejo und auf dem PC GitHub. Pushen nach jedem Commit:
  ```bash
  git push forgejo dev/design-system && git push github dev/design-system
  ```
- Dev-Server, falls gebraucht: Backend 8001, Frontend 3001, `127.0.0.1` statt
  `localhost` (Cookie-Kollision mit einem zweiten Stack). `VITE_API_URL` immer
  in der Shell setzen, nie nur in `.env.local`. Karten und Layer nur im
  Produktions-Build abnehmen (`vite build` + `vite preview`).

## 3. Die dreizehn Entscheidungen des Owners — bindend

Aus `2026-09-05-web-redesign-rueckmeldung.md` §9. Der Export von Runde 2/3
kennt sie **nicht** (Claude Design hat die Fassung ohne Antworten gelesen);
wo Export und Entscheidung auseinanderliegen, gilt die Entscheidung:

| # | Entscheidung | Folge für die Umsetzung |
|---|---|---|
| 1 | Ortslisten und Admin als eigene Seiten | wie im Export |
| 2 | Developer Mode / Training nur Admin | Nutzer-Einstellungen verlieren den Abschnitt; Admin behält ihn |
| 3 | Kein öffentliches Profil | nichts bauen |
| 4 | `domainColors` bleibt „so wie jetzt" | Beta-Override in den Einstellungen bleibt inkl. Farbwähler; Token-Defaults = Companion-Farben; die Karte „Kartenfarbe pro Eintrag" am Kreuzfahrt-Detail gibt es NICHT |
| 5 | BRAND.md / travstats.de nach Block 1 | nicht Teil dieses Auftrags (anderes Repo) |
| 6 | Überall Hanken Grotesk, Syne fällt | Web: Inter und Syne raus, Hanken Grotesk 400–800 + IBM Plex Mono + Newsreader kursiv |
| 7 | Touren = EINE Domänenfarbe | `domainColor.tour` — zuerst in die Companion-Tokendatei (`TravStatsCompanion/ClaudeDesign/handoff/tokens.json`), dann per Kopie hierher; die fünf Web-Farben train/hike/bike/road/ferry fallen; Verkehrsmittel nur per Icon |
| 8 | 2.7.0 auf `dev/design-system` | genau dieser Zweig |
| 9 | 800-Zeilen-Grenze ratifiziert | `npm run check:size` bleibt grün; Baseline nur senken |
| 10 | Parser ins Beta-Register | ist auf `dev/v2.7` geschehen (`parserTemplates`); der Export zeigt den Parser OHNE Plakette — **falsch**, die Plakette bleibt |
| 11 | Einstellungen als Routen pro Gruppe | `/settings/account`, `/settings/display`, `/settings/data`, `/settings/services`, plus Domänen-Reiter; der Export hat noch eine Seite mit Sprungmarken — **umbauen** |
| 12 | Dashboard-Tabs bleiben | wie im Export von Runde 2 (Tab-Leiste, Modus pro Tab, URL trägt beides) |
| 13 | Mitreisende und Tags auf alle vier Domänen | Datenmodell-Erweiterung (`LodgingCompanion`, `PlaceVisitCompanion`, `tags` an `Lodging`/`Place`) per `prisma migrate dev`, `check:drift` grün; der Export zeigt sie nur an drei Domänen — **erweitern**; Verwaltungsseite Einstellungen → Konto → Mitreisende wie im Export |

Dazu die drei Fragen aus Runde 2, hier entschieden (Empfehlung des
Entwicklers, vom Owner nicht widersprochen — bei Zweifel so bauen):
14. „Sichtbarkeit" bleibt im Tab „Alle".
15. Kuratierte Checkliste: beim Abhaken das Datum abfragen, mit heute vorbelegt.
16. Jahresrückblick als eigene Route `/review/:year`, aus der Statistik verlinkt.

## 4. Die sieben Blöcke — Reihenfolge und Ergebnis

Aus `2026-09-05-web-vereinheitlichung.md` §4, hier mit dem, was seit dem 05.09.
hinzukam. Jeder Block endet mit einem Commit-Satz, den Gates und einem
Browser-Blick (Screenshots 1440×900 und 390×844 nach
`ClaudeDesign/screenshots/design-system/<block>/`, ins Repo).

### Block 1 — Fundament
- Generator `design/tokens.json` → `frontend/src/theme/tokens.css` (Custom
  Properties + Tailwind `@theme`), als `npm run tokens` im Frontend, mit einem
  Test, der scheitert, wenn die CSS nicht zur JSON passt.
- Schriften: Hanken Grotesk, IBM Plex Mono, Newsreader (selbst gehostet unter
  `frontend/public/fonts/` — kein Google-Fonts-Aufruf, die CSP verbietet ihn;
  `font-display: swap`). Typo-Utilities `.t-hero` … `.t-meta-mono`.
- `AppShell` (Kopfleiste + Container in drei Breiten `reading` 720 / `list`
  1200 / `full`). Heute importiert jede Seite `NavigationBar` selbst.
- Bewegungs-Tokens `motion.fast/base/enter` aus `MOTION.md` — als Token-Block
  zuerst in die Companion-Datei, dann hierher (der Export hat sie direkt in die
  Web-Kopie geschrieben; das ist der falsche Weg).
- **Ergebnis:** Einstellungen vollständig auf dem neuen Fundament, dabei
  gleich als Routen pro Gruppe (Entscheidung 11). Screenshot vorher/nachher.

### Block 2 — Primitive (`frontend/src/components/ui/`)
Button · IconButton · Card/Tile/HeroCard · Pill/StatusPill · Chip ·
SectionLabel · StatTile · Dialog · Input/Select/Switch · EmptyState (vier
Arten) · PageHeader · Table/ListRow (unter 640 px wird die Tabelle zur
ListRow). Jedes Primitiv liest nur Tokens. Statuspille nach Companion-Rezept
(12 % Fläche, 45 % Rand, 11/700 Versalien, nie Mono). Mono nur auf Codes,
Kennungen, Messwerten, Zeitstempeln (`MONO_KEYS` im Export ist die Liste).
`faint` nur dekorativ, nie für lesbaren Text (3,8 : 1).
- **Ergebnis:** `/design` (nur dev) zeigt jedes Primitiv in jedem Zustand —
  die Abnahmefläche. Vorlage: `Design Primitives.dc.html` im Export.

### Block 3 — Logbuch-Familie
Vier Listen (Flüge, Kreuzfahrten, Unterkünfte, Orte) und die Detailseiten
(Flug, Kreuzfahrt, Unterkunft, Ort, Kette, Flugzeug). Eine Zeile sieht in
allen vier Listen gleich aus; ein Status ist überall dieselbe Pille; Flaggen
aus `/api/v1/country-flags/:cc` (18×13, Radius 2).
- **Ergebnis:** Screenshots der vier Listen nebeneinander, mobil als ListRow.

### Block 4 — Dashboard und Karten
Tab-Leiste bleibt (Entscheidung 12), Karte-Panel nur mit den Modi des aktiven
Tabs, Sichtbarkeit im Tab „Alle", Legende und Layer lesen ihre Farben aus den
Stores und die Stores aus den Tokens. Der Globus nach der Spezifikation in
`Globus.dc.html` (vierzehn Festlegungen — jede wird ein Token oder eine Regel
in `tokens.json → map`, heute hart codiert in `MapContainer3D` und den
Layern). Mobil: Panels weg, Bottom-Sheet „Karte" mit Reitern.
- **Ergebnis:** Legende und Routen stimmen mit den Domänenfarben der App
  überein; Globus-Screenshot in beiden Breiten; **kein horizontaler Scroll
  bei 390 px** (der Export hat ihn noch, die Kopfleiste ist eine Position zu
  breit — auf mobil fällt die Suche in „Mehr").

### Block 5 — Statistik, Erfolge, Jahresrückblick
Diagrammpalette einführen; **Domänen-Serien tragen `domainColor`, `chartColors`
nur für Serien ohne Domäne**; StatTile; Tier-Farben aus Tokens; die 17
h1-Varianten auf `.t-screen-title`. Jahresrückblick `/review/:year` nach
`Jahresrueckblick.dc.html` (heroGradient, Newsreader-Satz, vier Domänenkarten,
Karte des Jahres, Erfolge, Vergleich, Druck). Kein Diagramm wird am Fold
abgeschnitten.
- **Ergebnis:** jede Serie in jedem Diagramm hat eine Token-Farbe.

### Block 6 — Reisen, Reisepass, Posteingang, Werkzeuge
Reise-Hero und Reise-Karten; Reisepass als die eine helle Fläche (`paper`),
Stempel-Ansicht, Druckansicht A4 nach `Druckansicht.dc.html` (das
Flug-Zertifikat auf dieselbe Papierfarbe); Posteingang mit vier
Leerzuständen; Import-Logbuch als Seite; Schnellsuche ⌘K nach `Suche.dc.html`;
Mitreisende-Verwaltung; Tag-Übersicht; Kopplungs-Moment in Geräte.
- **Ergebnis:** der Reisepass sieht aus wie auf dem Telefon.

### Block 7 — Aufräumen und Wächter
13 nie definierte CSS-Variablen (Anhang A.4 der Übergabe) ersetzen; 93
`dark:`-Klassen löschen; 542 rohe Tailwind-Farbklassen; 6 Farbpaletten →
`listColor`; Inter und Syne aus `index.html` und `index.css`. Die vier Wächter
aus `DESIGN_SYSTEM.md` §10: Generator-Test, Hex-Ratchet (kein neuer Hex im
Code), Palette-/`dark:`-Scan, Overlay-Scan (kein `fixed inset-0` außerhalb des
Dialog-Primitivs).
- **Ergebnis:** die Ratchets sind grün und dürfen nur noch schrumpfen.

## 5. Gates — vor jedem Commit

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
cd ../backend && npx tsc --noEmit && npm run lint        # Backend-Jest nur, wenn eine Datenbank erreichbar ist
cd .. && npm run check:size
```

- Jede Verhaltensänderung bringt einen Test mit, der ohne sie rot wäre.
- DE und EN bewegen sich zusammen (`localeKeyParity.test.ts` beißt).
- Beta-Plaketten kommen aus dem Register (`betaFeatures.test.ts` beißt).
- OpenAPI- und Antwortform-Ratchets bleiben grün, wenn das Backend berührt
  wird (Entscheidung 13 berührt es).
- Prettier vor dem Commit (`npx prettier --write` auf die geänderten Dateien),
  sonst dreht der Pre-Commit-Hook Schleifen.

## 6. Nicht tun

- **Nicht nach `main` und nicht nach `dev/v2.7` mergen.** Der Zweig wird
  gemeldet, gemergt wird auf dem PC nach Owner-Entscheidung.
- **`backend/VERSION` und `CHANGELOG.md` nicht anfassen** — beides gehört
  `/deploy` auf `main`.
- **Kein Deploy, kein `/deploy`, kein Discord, kein GitHub-Issue, kein
  Forgejo-Kommentar.** Berichte gehen in `ClaudeDesign/handoff/` und in die
  Übergabenotiz.
- **Kein neuer Hex-Wert im Code.** Was fehlt, wird ein Token — zuerst in der
  Companion-Datei, dann hier.
- **Kein Emoji als Chrome**, kein zweites Icon-Set neben Lucide.
- **Keine Junction/Symlink für `node_modules`**, kein `git worktree remove`
  ohne vorheriges Lösen eventueller Links.
- **Kein `origin`.** Immer `forgejo` und `github` ausschreiben.
- **Keine Änderung an `betaFeatures.ts`-Schlüsseln** außer dem, was
  Entscheidung 13 verlangt (nichts). Ent-gaten ist Owner-Sache.

## 7. Entscheiden statt fragen

Der Owner hat „ohne Nachfragen" gesagt. Regeln für den Rest:

1. Zielbild ist der Export; wo der Export einer Entscheidung aus §3
   widerspricht, gilt §3; wo beides schweigt, gilt `DESIGN_SYSTEM.md`; wo auch
   das schweigt, entscheidet, was der Companion tut.
2. Ist etwas im Export nur skizziert (Dialoge-Seite ist ein Verzeichnis, der
   mobile Globus ein Platzhalter), wird nach den Regeln gebaut und die
   Entscheidung im Block-Bericht festgehalten.
3. Ein Token, das fehlt, wird angelegt (Companion-Datei zuerst) und im Bericht
   genannt — nie ein Hex im Code.
4. Was das Backend braucht (Entscheidung 13), wird sauber per Migration
   gebaut, mit Tests; was darüber hinausginge, wird als Notiz für den PC
   festgehalten, nicht gebaut.
5. Kommt ein Gate nicht grün, ist der Block nicht fertig. Kein „später".

## 8. Bericht

Pro Block ein Abschnitt in
`ClaudeDesign/handoff/2026-09-0N-design-system-block-<n>-bericht.md`: gebaut,
entschieden (mit Grund), offen, Screenshots, Gate-Ausgaben (Zahlen). Am Ende
jeder Sitzung `/home/claude/UEBERGABE.md` aktualisieren: Zweig-Tip, was läuft,
was der PC wissen muss. Der Owner liest die Berichte; der Merge nach `dev/v2.7`
ist seine Entscheidung und wird ihm als eine einzelne, isolierte Frage
gestellt.

## 9. Was der Auftrag nicht umfasst

- BRAND.md und travstats.de (Repo `TravStatsWeb`) — nach Block 1 gesondert.
- Companion-Änderungen außer den Token-Dateien.
- Ent-gaten von Beta-Funktionen; das läuft auf `dev/v2.7` und ist Owner-Sache.
- Das Merge nach `dev/v2.7` oder `main`.

## 10. Startprompt für die Sitzung auf CT142

Vom Owner am 05.09.2026 angefordert; in der Claude-App Host `ct142`, Projekt
TravStats, Modell Fable wählen und diesen Text als erste Nachricht senden:

```
Lies /home/claude/UEBERGABE.md und danach den dort genannten Auftrag
ClaudeDesign/handoff/2026-09-06-auftrag-design-system-ct142.md auf dem Zweig dev/v2.7
(git fetch forgejo zuerst). Richte den Worktree .worktrees/design-system mit dem
Zweig dev/design-system von forgejo/dev/v2.7 ein, wie im Auftrag beschrieben, und
arbeite die sieben Blöcke in der angegebenen Reihenfolge ab.

Arbeite autonom: keine Rückfragen an mich. Wo etwas offen ist, gelten die
Entscheidungsregeln in Abschnitt 7 des Auftrags; wo Export und Owner-Entscheidungen
(Abschnitt 3) auseinanderliegen, gilt die Entscheidung. Halte dich an Abschnitt 6
(Nicht tun): kein Merge nach main oder dev/v2.7, kein Deploy, kein Discord, keine
Issues, VERSION und CHANGELOG unberührt, Remotes immer als forgejo und github
ausschreiben.

Nach jedem Block: Gates grün (frontend tsc, lint, vitest, check:size; backend tsc
und lint, wenn berührt), Screenshots 1440×900 und 390×844 nach
ClaudeDesign/screenshots/design-system/<block>/, Bericht nach
ClaudeDesign/handoff/2026-09-0N-design-system-block-<n>-bericht.md, Commit, Push nach
forgejo und github, dann forgejo/dev/v2.7 hineinmergen. Am Sitzungsende
/home/claude/UEBERGABE.md aktualisieren. Beginne mit Block 1.
```
