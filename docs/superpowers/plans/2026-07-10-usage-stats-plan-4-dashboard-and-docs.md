# Public Dashboard + Transparency Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `travstats.de/stats` dashboard rendering the community rollup, and the transparency docs page that every consent surface links to.

**Architecture:** An Astro page fetching `GET https://stats.travstats.de/v1/aggregate` client-side. Charts are hand-rolled inline SVG — TravStatsWeb has no chart library and does not need one for seven small charts. DE primary at `/stats`, EN mirror at `/en/stats`, matching the site's hand-rolled dual-page i18n.

**Tech Stack:** Astro 6, TypeScript, Tailwind 4 (via the Vite plugin), inline SVG. No new runtime dependency.

## Global Constraints

- Repo: **`D:\TravStats_Projekt\TravStatsWeb`** — a sibling of `TravStats`, not inside it.
- Spec: `TravStats/docs/superpowers/specs/2026-07-10-anonymous-usage-stats-design.md`, §8.
- **Depends on Plan 3.** `GET /v1/aggregate` must be live, or at least its `Aggregate` interface frozen, before Task 2.
- **No chart library.** TravStatsWeb has zero charting dependencies and no client-side external fetch anywhere today. Both are new patterns here; keep the footprint minimal. The existing precedent is the hand-rolled `IntersectionObserver` counter in `src/pages/index.astro` — match it.
- **i18n:** no framework. German lives at `/…`, English mirrors at `/en/…`. Copy is inline per `.astro` file. Every new page passes `lang` and `alternateLanguageUrl` to `BaseLayout.astro` and must be added to `I18N_PAIRS` in `astro.config.mjs`.
- **The kilometre headline must say "mindestens" / "at least".** `Flight.routeDistance` is nullable, so the community sum is a lower bound. Printing it as an exact total would be a number that is simply wrong.
- Theme-aware: the site is dark-only per `BRAND.md`; use the existing CSS tokens in `src/styles/tokens.css` rather than inventing colours.
- Follow the `dataviz` skill for palette and chart form. Read it before Task 3.
- All code and comments in English. Page copy: DE and EN.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/statsClient.ts` | **Create.** Typed fetch + the `Aggregate` interface. Mirrors Plan 3's `src/aggregate.ts`. |
| `src/lib/formatStats.ts` | **Create.** Pure formatters: km → "1,2 Mio.", percentage splits, rarity ordering. |
| `src/components/stats/StatHeadline.tsx` | **Create.** The two big numbers. |
| `src/components/stats/BarChart.tsx` | **Create.** Reusable inline-SVG horizontal bars. |
| `src/components/stats/GrowthChart.tsx` | **Create.** Inline-SVG line chart over `growth[]`. |
| `src/components/stats/StatsBoard.tsx` | **Create.** The one React island that fetches and renders. |

All four are `.tsx`, not `.astro`: they are consumed from inside a React island, and
Astro components cannot be imported into React.
| `src/pages/stats.astro` | **Create.** DE page. |
| `src/pages/en/stats.astro` | **Create.** EN mirror. |
| `src/content/docs/docs/usage-statistics.md` | **Create.** Transparency page (Starlight, EN-only wiki). |
| `src/pages/datenschutz.astro` / `src/pages/en/privacy.astro` | **Modify.** Cloudflare + telemetry disclosure. |
| `astro.config.mjs` | **Modify.** Add the `/stats` ↔ `/en/stats` i18n pair. |
| `src/data/version.ts` | **Modify.** Bump to `2.4.0` at promote time (not now). |

One React island rather than seven: the page has a single data dependency, and
seven islands would fetch seven times.

---

### Task 1: Typed client + pure formatters

**Files:**
- Create: `src/lib/statsClient.ts`, `src/lib/formatStats.ts`
- Test: `src/lib/__tests__/formatStats.test.ts`

**Interfaces:**
- Produces: `interface Aggregate` (structurally identical to Plan 3's), `fetchAggregate(baseUrl?: string): Promise<Aggregate | null>`, `formatMillionsKm(km: number, locale: "de" | "en"): string`, `toPercentages(counts: Record<string, number>): { label: string; count: number; percent: number }[]`, `topRarity(rarity, limit): { key: string; installs: number }[]`. Tasks 2-3 import these.

TravStatsWeb has no test runner today. Add Vitest — a formatter that silently
mis-rounds the headline number is exactly the bug nobody notices.

- [ ] **Step 1: Add Vitest**

```bash
cd D:/TravStats_Projekt/TravStatsWeb
npm install -D vitest
```

Add to `package.json` scripts: `"test": "vitest --run"`.

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/formatStats.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatMillionsKm, toPercentages, topRarity } from "../formatStats";

describe("formatMillionsKm", () => {
  it("formats millions with a German decimal comma", () => {
    expect(formatMillionsKm(42_800_000, "de")).toBe("42,8 Mio.");
  });

  it("formats millions with an English decimal point", () => {
    expect(formatMillionsKm(42_800_000, "en")).toBe("42.8M");
  });

  it("falls back to thousands below one million", () => {
    expect(formatMillionsKm(128_400, "de")).toBe("128.400");
    expect(formatMillionsKm(128_400, "en")).toBe("128,400");
  });

  it("handles zero without printing '0,0 Mio.'", () => {
    expect(formatMillionsKm(0, "de")).toBe("0");
  });
});

describe("toPercentages", () => {
  it("computes shares that sum to 100", () => {
    const result = toPercentages({ amd64: 3, arm64: 1 });
    expect(result).toEqual([
      { label: "amd64", count: 3, percent: 75 },
      { label: "arm64", count: 1, percent: 25 },
    ]);
  });

  it("sorts descending by count", () => {
    expect(toPercentages({ a: 1, b: 5 }).map((r) => r.label)).toEqual(["b", "a"]);
  });

  it("returns an empty array for no data, never NaN", () => {
    expect(toPercentages({})).toEqual([]);
  });

  it("does not divide by zero when every count is zero", () => {
    const result = toPercentages({ a: 0, b: 0 });
    expect(result.every((r) => r.percent === 0)).toBe(true);
  });
});

describe("topRarity", () => {
  it("returns the rarest trophies first — fewest installs", () => {
    const input = [
      { key: "common", installs: 10 },
      { key: "rare", installs: 1 },
      { key: "mid", installs: 5 },
    ];
    expect(topRarity(input, 2).map((r) => r.key)).toEqual(["rare", "mid"]);
  });

  it("tolerates an empty list", () => {
    expect(topRarity([], 5)).toEqual([]);
  });
});
```

Note `topRarity` sorts **ascending** — the interesting entry in a rarity ranking is
the trophy almost nobody has. Plan 3's `achievement_rarity` arrives sorted
descending (most-unlocked first); this reverses it deliberately.

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest --run
```
Expected: FAIL — cannot resolve `../formatStats`.

- [ ] **Step 4: Implement `src/lib/formatStats.ts`**

```typescript
/** Pure formatters for the public stats dashboard. No DOM, no fetch. */

export function formatMillionsKm(km: number, locale: "de" | "en"): string {
  if (km === 0) return "0";
  const intl = locale === "de" ? "de-DE" : "en-US";
  if (km < 1_000_000) return km.toLocaleString(intl);

  const millions = Math.round((km / 1_000_000) * 10) / 10;
  const formatted = millions.toLocaleString(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return locale === "de" ? `${formatted} Mio.` : `${formatted}M`;
}

export interface Share {
  label: string;
  count: number;
  percent: number;
}

export function toPercentages(counts: Record<string, number>): Share[] {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return Object.entries(counts)
    .map(([label, count]) => ({
      label,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface Rarity {
  key: string;
  installs: number;
}

/** Rarest first: the trophy almost nobody holds is the interesting one. */
export function topRarity(rarity: Rarity[], limit: number): Rarity[] {
  return [...rarity]
    .sort((a, b) => a.installs - b.installs || a.key.localeCompare(b.key))
    .slice(0, limit);
}
```

- [ ] **Step 5: Implement `src/lib/statsClient.ts`**

```typescript
/**
 * Client for the travstats-stats aggregate endpoint.
 *
 * Structurally mirrors `Aggregate` in travstats-stats/src/aggregate.ts. If that
 * shape changes, this must change with it — there is no shared package.
 */

export interface Aggregate {
  active_installs: number;
  /** LOWER BOUND for flights: Flight.routeDistance is nullable client-side. */
  total_distance_km: { flight: number; cruise: number };
  total_achievements: number;
  achievement_rarity: { key: string; installs: number }[];
  versions: Record<string, number>;
  arch: Record<string, number>;
  locales: Record<string, number>;
  domains: Record<string, number>;
  size_buckets: {
    users: Record<string, number>;
    flights: Record<string, number>;
    cruises: Record<string, number>;
  };
  features: Record<string, number>;
  growth: { day: string; active_count: number }[];
  generated_at: string;
}

const DEFAULT_BASE_URL = "https://stats.travstats.de";

/** Returns null on any failure. The dashboard degrades to an empty state, never an error page. */
export async function fetchAggregate(baseUrl: string = DEFAULT_BASE_URL): Promise<Aggregate | null> {
  try {
    const response = await fetch(`${baseUrl}/v1/aggregate`);
    if (!response.ok) return null;
    return (await response.json()) as Aggregate;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest --run
```
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(stats): add typed aggregate client and pure dashboard formatters"
```

---

### Task 2: The dashboard island

**Files:**
- Create: `src/components/stats/StatsBoard.tsx`
- Create: `src/components/stats/BarChart.astro`, `src/components/stats/GrowthChart.astro`, `src/components/stats/StatHeadline.astro`

**Interfaces:**
- Consumes: `fetchAggregate`, `formatMillionsKm`, `toPercentages`, `topRarity` (Task 1).
- Produces: `StatsBoard` (default export) with props `{ lang: "de" | "en" }`. Task 3 mounts it with `client:visible`.

Before writing chart markup, **read the `dataviz` skill** for the palette, the form
heuristic, and the axis/legend rules. Do not pick colours by eye.

Three states must all be handled, and the empty state is the one that will actually
be seen on launch day, when zero installs have consented:

| State | Rendering |
|---|---|
| Loading | Skeleton, no layout shift. |
| Fetch failed (`null`) | A short, honest line: "Die Statistik ist gerade nicht erreichbar." Never a stack trace, never a fake zero. |
| Zero installs | The real dashboard with real zeroes, plus one sentence explaining it is opt-in and new. **Not** an error. |

- [ ] **Step 1: Build the empty and error states first**

Write `StatsBoard.tsx` so that it renders correctly for `null` and for a
zero-filled `Aggregate` **before** adding a single chart. Verify both in the browser
by temporarily returning them from `fetchAggregate`. This ordering matters: a
dashboard built happy-path-first invariably ships an empty state nobody looked at.

Sketch:

```tsx
import { useEffect, useState } from "react";
import { fetchAggregate, type Aggregate } from "../../lib/statsClient";
import { formatMillionsKm } from "../../lib/formatStats";

interface StatsBoardProps { lang: "de" | "en"; }

const COPY = {
  de: {
    unavailable: "Die Statistik ist gerade nicht erreichbar.",
    empty: "Noch keine Daten. Die Statistik ist freiwillig und wurde gerade erst eingeführt.",
    installs: "aktive Installationen",
    distance: "zusammen mindestens",
    distanceUnit: "km gereist",
    trophies: "Trophäen gesammelt",
  },
  en: {
    unavailable: "The statistics are currently unavailable.",
    empty: "No data yet. Reporting is voluntary and was only just introduced.",
    installs: "active installations",
    distance: "at least",
    distanceUnit: "km travelled together",
    trophies: "trophies collected",
  },
} as const;

export default function StatsBoard({ lang }: StatsBoardProps): JSX.Element {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [data, setData] = useState<Aggregate | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAggregate().then((result) => {
      if (cancelled) return;
      if (result === null) { setState("error"); return; }
      setData(result);
      setState("ready");
    });
    return () => { cancelled = true; };
  }, []);

  const copy = COPY[lang];

  if (state === "loading") return <div aria-busy="true">…skeleton…</div>;
  if (state === "error" || data === null) return <p>{copy.unavailable}</p>;

  const totalKm = data.total_distance_km.flight + data.total_distance_km.cruise;

  return (
    <>
      {/* The "mindestens"/"at least" qualifier is required: routeDistance is nullable. */}
      <StatHeadline
        installs={data.active_installs}
        distance={`${copy.distance} ${formatMillionsKm(totalKm, lang)} ${copy.distanceUnit}`}
        trophies={`${data.total_achievements.toLocaleString(lang === "de" ? "de-DE" : "en-US")} ${copy.trophies}`}
      />
      {data.active_installs === 0 && <p>{copy.empty}</p>}
      {/* charts follow */}
    </>
  );
}
```

- [ ] **Step 2: Verify both degenerate states in a browser**

```bash
npm run dev
```
Visit the page (Task 3 creates it; do this step after Task 3 Step 1 if you prefer).
Force each state by temporarily editing `fetchAggregate` to `return null` and to
return a zero-filled object. Confirm: no stack trace, no `NaN`, no `0,0 Mio.`,
no layout jump between skeleton and content.

- [ ] **Step 3: Add the charts**

Seven visuals, per spec §8: growth line, version distribution, domain usage, arch
split, feature adoption, deployment-size distribution, trophy rarity ranking.

`BarChart.tsx` takes `{ shares: Share[]; title: string }` and renders inline SVG
horizontal bars with the label, count, and percent as text — no tooltip library, no
hover-only information. Every value must be readable without interaction, because a
static screenshot of this page is the thing people will share.

`GrowthChart.tsx` takes `{ points: { day: string; active_count: number }[] }`. With
fewer than two points, render a single dot and the count rather than a degenerate
one-pixel line.

Label `arm64` as "ARM64 — Raspberry Pi, Apple Silicon, …": the payload genuinely
cannot distinguish a Pi from any other arm64 host, and an unqualified "ARM64" invites
readers to assume it means Raspberry Pi.

- [ ] **Step 4: Typecheck and commit**

```bash
npx astro check
git add -A
git commit -m "feat(stats): add dashboard island with loading, error and zero-install states"
```

---

### Task 3: The pages, DE and EN

**Files:**
- Create: `src/pages/stats.astro`, `src/pages/en/stats.astro`
- Modify: `astro.config.mjs`

**Interfaces:**
- Consumes: `StatsBoard` (Task 2).
- Produces: `travstats.de/stats` and `travstats.de/en/stats`.

- [ ] **Step 1: Create the German page**

`src/pages/stats.astro`. Match the frontmatter shape of `src/pages/index.astro`:
`structuredData`, then `<BaseLayout lang="de" title=… description=… structuredData=…
alternateLanguageUrl="/en/stats">`, `<Header lang="de" />`, `<main>`, `<Footer />`.

Mount the island with `client:visible` (it fetches on mount; there is no reason to
hydrate above the fold):

```astro
<StatsBoard client:visible lang="de" />
```

The page copy must state plainly, above the numbers: the statistics are **opt-in**,
**anonymous**, and represent **only consenting installations** — so the real user
count is higher than the number shown. Link to the transparency docs page. Claiming
`active_installs` is "our user count" would be false, and this page is public.

- [ ] **Step 2: Create the English mirror**

`src/pages/en/stats.astro`, identical structure, `lang="en"`,
`alternateLanguageUrl="/stats"`, `<StatsBoard client:visible lang="en" />`.

- [ ] **Step 3: Register the i18n pair**

In `astro.config.mjs`, add to `I18N_PAIRS`:

```js
  { de: "/stats", en: "/en/stats" },
```

This drives the sitemap hreflang pairs. Without it the two pages look like
duplicate content to search engines.

- [ ] **Step 4: Verify the CSP actually allows the fetch**

The dashboard is the first client-side external fetch in this repo. It will be
blocked unless `connect-src` on CT133 includes `https://stats.travstats.de`
(Plan 3, Task 6, Step 3).

```bash
npm run build && npm run preview
```
Open `http://localhost:4321/stats`, open DevTools → Console. Expected: no CSP
violation, the fetch succeeds or fails on network grounds only. A `Refused to
connect` error here means the CSP snippet was not updated — fix it in Plan 3 before
deploying, not after.

- [ ] **Step 5: Build and commit**

```bash
npm run build
git add -A
git commit -m "feat(stats): add public /stats dashboard pages in DE and EN"
```

---

### Task 4: Transparency docs + privacy policy

**Files:**
- Create: `src/content/docs/docs/usage-statistics.md`
- Modify: `src/pages/datenschutz.astro`, `src/pages/en/privacy.astro`

**Interfaces:**
- Produces: `https://travstats.de/docs/usage-statistics` — the URL hard-coded as `DOCS_URL` in `UsageStatsConsentCard.tsx` (Plan 2, Task 7). **If you change this path, change it there too.**

The Starlight wiki is intentionally EN-only, so this page is English. The consent
card links to it from both languages, which is a known and accepted asymmetry.

- [ ] **Step 1: Write the docs page**

`src/content/docs/docs/usage-statistics.md` must contain, in this order:

1. **What this is:** opt-in, off by default, instance-wide, admin-controlled.
2. **The payload, verbatim.** Copy the JSON block from spec §5 exactly — not a
   paraphrase, not a summary. This is the whole point of the page. A reader must be
   able to diff it against what their instance sends.
3. **The provenance table** from spec §5, so every field's origin is inspectable.
4. **What is never sent:** IP, hostname, paths, airport/port/ship/airline names,
   travel dates, usernames, e-mail addresses, API keys, exact counts.
5. **`install_id`:** a random uuid4, never derived from IP, hostname, MAC, or paths.
   Where to find it in the admin UI.
6. **How to turn it off:** the admin toggle, and that switching to "off" **deletes**
   this installation's stored row on the server.
7. **The kill-switch:** `TRAVSTATS_STATS_ENDPOINT=""` disables all sending regardless
   of consent — for self-hosters who want the guarantee in their own config.
8. **Retention:** installs unseen for 180 days are hard-deleted; `daily_active` holds
   only counts with no subject link.
9. **Rate limiting and IPs:** the address is hashed in memory for abuse prevention
   and never persisted; the reverse proxy does not log it either.
10. **Cloudflare:** terminates the tunnel and therefore sees client IPs; third-country
    transfer disclosed.

- [ ] **Step 2: Update both privacy policies**

`src/pages/datenschutz.astro` (DE) and `src/pages/en/privacy.astro` (EN) each gain a
section covering: the opt-in telemetry, the legal bases (Art. 6 (1) a for the
payload; Art. 6 (1) f for the transient rate-limit IP), the recipient (Cloudflare,
third-country transfer), the retention periods, and the data-subject rights with the
`install_id` as the identifier for an access or erasure request.

Write the German first and mirror it to English, per the language policy.

- [ ] **Step 3: Verify the consent-card link resolves**

```bash
npm run build && npm run preview
curl -sI http://localhost:4321/docs/usage-statistics | head -1
```
Expected: `HTTP/1.1 200 OK`. A 404 here means every consent surface in the app links
into the void — the one link a privacy-conscious user is guaranteed to click.

- [ ] **Step 4: Cross-check the docs against the shipped payload**

Read `TravStats/backend/src/services/usageStats/payload.ts` and compare the returned
object, field by field, against the JSON block you pasted in Step 1. They must match
exactly. If they diverge, the docs page is a false statement about data processing —
fix whichever side is wrong.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(stats): add verbatim transparency page and privacy-policy telemetry section"
```

---

### Task 5: Deploy

**Files:** none — deployment only.

- [ ] **Step 1: Deploy the apex**

Use the standard TravStatsWeb recipe from `CLAUDE.local.md`:

```bash
cd D:/TravStats_Projekt/TravStatsWeb
npx astro build
tar -czf /tmp/travstats-apex.tgz -C dist .
scp /tmp/travstats-apex.tgz root@<pve-node1>:/tmp/
ssh root@<pve-node1> \
  "pct push 133 /tmp/travstats-apex.tgz /tmp/dist.tgz && \
   pct exec 133 -- bash -c 'rm -rf /var/www/html/* /var/www/html/.[!.]*; \
     tar --no-same-owner -xzf /tmp/dist.tgz -C /var/www/html && \
     rm /tmp/dist.tgz && chown -R www-data:www-data /var/www/html && \
     nginx -t && systemctl reload nginx'"
```

- [ ] **Step 2: Smoke test in production**

```bash
curl -sI https://travstats.de/stats | head -1
curl -sI https://travstats.de/en/stats | head -1
curl -sI https://travstats.de/docs/usage-statistics | head -1
curl -s https://stats.travstats.de/v1/aggregate | head -c 200
```
Expected: three `200 OK`s and a JSON body.

Then open `https://travstats.de/stats` in a real browser and check the console for
CSP violations. `curl` cannot see a blocked `connect-src`; only the browser can.

- [ ] **Step 3: Do NOT bump `src/data/version.ts` yet**

`TRAVSTATS_VERSION` feeds the JSON-LD `softwareVersion`. It is bumped in lockstep
with an RC **promotion**, not with a feature merge. It moves to `2.4.0` when 2.4.0 is
promoted to final tags — that is a separate, later action.

---

## Done criteria

- `npx vitest --run` green; `npx astro check` clean; `npm run build` succeeds.
- `/stats` and `/en/stats` render, hreflang-paired, with no console errors.
- The kilometre headline reads "mindestens" / "at least".
- The zero-install state is a real dashboard with real zeroes, not an error.
- `arm64` is labelled so nobody reads it as "Raspberry Pi".
- `/docs/usage-statistics` returns 200 and its payload block matches
  `payload.ts` field for field.
- Both privacy policies disclose the telemetry, the legal bases, and Cloudflare.
- `src/data/version.ts` is unchanged.
