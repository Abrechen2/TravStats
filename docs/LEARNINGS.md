# TravStats — Learnings

Lessons captured from bugs, reviews, and incidents.
Add new entries at the top.

---

## 2026-03-31 — Auth reload loop after store hydration

**Problem:** `onRehydrateStorage` in `authStore.ts` removed the `auth:unauthorized` event listener after hydration but did not add a new one. Result: 401 errors no longer triggered a logout, only the fallback hard reload via `window.location.href`. Because the user was still in localStorage, `/login` immediately redirected back to `/` → infinite loop.

**Fix:** Removed the event listener cleanup from `onRehydrateStorage`. The listener now survives hydration, since `get()` always returns the current store state. Increased the fallback timeout from 200ms to 500ms and clear localStorage before the hard reload as defense in depth.

**Lesson:** Only use Zustand `onRehydrateStorage` for genuine cleanup logic — not for event listeners that need to live on permanently.

---

## 2026-03 — deck.gl + MapLibre WebGL conflict

**Problem:** The `<DeckGL>` React component + MapLibre 5.x create two separate WebGL contexts → one is destroyed immediately.

**Fix:** Use the `MapboxOverlay` + `useControl` hook from `@deck.gl/mapbox` — deck.gl renders as an overlay inside MapLibre's WebGL context.

**Lesson:** Always check whether WebGL sharing is required when using map libraries. Never put two independent GL contexts on the same canvas.

---

## 2026-02 — Prisma `any` in JSON fields

**Problem:** `Record<string, unknown>` cannot be assigned directly to `Prisma.InputJsonObject` (TypeScript error).

**Fix:** `as unknown as Prisma.InputJsonValue` — a two-step cast via `unknown`.

**Lesson:** Prisma's JSON types are extra strict. Always use `Prisma.InputJsonValue` as the target type.
