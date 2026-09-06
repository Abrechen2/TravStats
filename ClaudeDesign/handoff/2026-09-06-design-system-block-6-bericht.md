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
