# TravStats — Learnings

Festgehaltene Erkenntnisse aus Bugs, Reviews und Incidents.
Neue Einträge oben einfügen.

---

## 2026-03-31 — Auth-Reload-Loop nach Store-Hydration

**Problem:** `onRehydrateStorage` in `authStore.ts` entfernte den `auth:unauthorized` Event-Listener nach der Hydration aber fügte keinen neuen hinzu. Ergebnis: 401-Fehler lösten keinen Logout mehr aus, sondern nur den Fallback-Hard-Reload mit `window.location.href`. Da der User noch in localStorage stand, redirectete `/login` sofort zurück zu `/` → Endlos-Loop.

**Fix:** Event-Listener-Cleanup aus `onRehydrateStorage` entfernt. Der Listener überlebt jetzt die Hydration, da `get()` immer den aktuellen Store-State liefert. Fallback-Timeout von 200ms auf 500ms erhöht + löscht localStorage vor Hard-Reload als Defense-in-Depth.

**Lesson:** Zustand `onRehydrateStorage` nur für echte Cleanup-Logik verwenden — nicht für Event-Listener die dauerhaft gebraucht werden.

---

## 2026-03 — deck.gl + MapLibre WebGL-Konflikt

**Problem:** `<DeckGL>` React-Komponente + MapLibre 5.x erstellen zwei getrennte WebGL-Kontexte → einer wird sofort zerstört.

**Fix:** `MapboxOverlay` + `useControl` Hook aus `@deck.gl/mapbox` — deck.gl rendert als Overlay in MapLibres WebGL-Kontext.

**Lesson:** Bei Map-Bibliotheken immer prüfen ob WebGL-Sharing nötig ist. Nie zwei unabhängige GL-Kontexte auf demselben Canvas.

---

## 2026-02 — Prisma `any` in JSON-Feldern

**Problem:** `Record<string, unknown>` kann nicht direkt zu `Prisma.InputJsonObject` zugewiesen werden (TypeScript-Fehler).

**Fix:** `as unknown as Prisma.InputJsonValue` — zweistufiger Cast über `unknown`.

**Lesson:** Prisma's JSON-Typen sind extra-strikt. Immer `Prisma.InputJsonValue` als Ziel-Typ verwenden.
