/**
 * One shared component per UI pattern (ui-unify, rc.47, package C).
 *
 * A source scan, because the thing it guards is a habit: a search box, a tab
 * set, a chip, an icon or a list table is easy to build by hand again, and the
 * hand-built ones are how twenty search fields ended up with different clear
 * buttons, eight tab sets with different keyboard handling and a sort arrow
 * that pointed the wrong way on two pages.
 *
 * Each pattern has a count per file in `uiPatterns.baseline.json`. A file may
 * not gain an occurrence, and a file that LOST one must lower its entry, so the
 * list only shrinks. The target is an empty baseline; `ILLUSTRATION_SVG` is the
 * one standing exception and names why.
 *
 * `UI_PATTERNS_UPDATE=1` rewrites the baseline, but only downwards.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");
const BASELINE_PATH = resolve(__dirname, "uiPatterns.baseline.json");

/** Drawn pictures, brand marks and chart marks: not icons, so not `<Icon>`. */
const ILLUSTRATION_SVG = new Set([
  "components/Brand/Abrechen2Wordmark.tsx",
  "components/Brand/Logo.tsx",
  "components/GlobeLoader.tsx",
  "components/friends/CompareRadar.tsx",
  "components/friends/Sparkline.tsx",
  "components/Stats/scorecard/Sparkline.tsx",
  "components/Trips/ElevationProfileChart.tsx",
  "components/Trips/TripGlobeAnnotations.tsx",
  "components/encryptedShare/TravelComparison.tsx",
  "components/Roadtrips/RoadtripSketch.tsx",
  "pages/Track/roadtrip/RoadtripSketch.tsx",
  "pages/Track/flight/TrackAltitudeProfile.tsx",
  "pages/TravPlan/sections/PlanActualSketch.tsx",
  "pages/DesignPage.tsx",
  "components/FlightCertificateParts.tsx",
  // Legend samples: a drawn stroke style, not a glyph.
  "components/Roadtrips/LegDialog.tsx",
  "components/Globe/GlobeControlPanel.tsx",
  // A spinner and an upload illustration.
  "components/AirportSeedingModal.tsx",
  "components/ReceiptUpload.tsx",
  // The route-editor / trip route cards draw a map thumbnail.
  "components/Trips/DetectReviewModal.tsx",
  // The legacy modal frame; package B deletes it.
  "components/Modal.tsx",
]);

/**
 * Raw `<table>`s that may stay, each with the reason. A table is a list when a
 * reader would want to re-order it; these are reports (the order is the
 * content), previews before a write, a chronological log, or an admin
 * diagnostic. A list belongs on `ui/Table` with `useSort`.
 */
const RAW_TABLE_REASON: Record<string, string> = {
  "components/Stats/AircraftRankingCard.tsx": "ranking: the order is the ranking",
  "components/Stats/insights/CruisePortsBlock.tsx": "ranking: the order is the ranking",
  "components/Stats/insights/CruiseDayPatternBlock.tsx": "report: a fixed distribution",
  "components/Stats/insights/FlightDiscoveryTable.tsx": "report: discovery order is the point",
  "components/Stats/insights/FlightTransfersBlock.tsx": "ranking: the order is the ranking",
  "components/Stats/lodging/LodgingLoyaltySection.tsx": "report: a fixed summary",
  "components/Settings/RemotePersonStats.tsx": "report: a fixed summary",
  "components/encryptedShare/TravelComparison.tsx": "report: two columns side by side",
  "pages/Track/TrackMonths.tsx": "report: months run in calendar order",
  "components/Training/ParseLogStats.tsx": "report: a fixed summary",
  "components/Admin/timeModel/ZoneReResolve.tsx": "admin diagnostic output",
  "components/Admin/timeModel/TimeMigrationTables.tsx": "admin diagnostic output",
  "components/Roadtrips/ShiftDaysDialog.tsx": "preview before a write: the file's order",
  "components/import/PreviewModal.tsx": "preview before a write: the file's order",
  "components/sharing/LinkExistingPanel.tsx":
    "preview before a write: one row per conflicting field",
  "components/lodging/LodgingImportPreviewModal.tsx": "preview before a write: the file's order",
  "components/places/PlaceImportPreviewModal.tsx": "preview before a write: the file's order",
  "components/changeHistory/ChangeHistoryList.tsx": "chronological log",
  // Lists, but each row expands into a full-width record (colSpan), which the grid Table cannot draw.
  "components/Passport/CountryTable.tsx": "rows expand into the evidence record (colSpan)",
  "components/Trips/TripBookingsPanel.tsx": "rows expand into an edit form (colSpan)",
  "components/places/listTable/PlaceListTable.tsx":
    "rows expand into the visit dates (colSpan); sorted and paged by the server, with plugin columns",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "generated") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const CODE_LINE = (line: string): boolean => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);
// Pictographs used as an icon. ★ ☆ stay out: a rating glyph is read as a
// rating (the number is always printed beside it), not as decoration.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2604}\u{2607}-\u{27BF}\u{2B50}]/u;

type Pattern = {
  name: string;
  /** Files under these paths are the pattern's own home. */
  home: RegExp;
  hit: (line: string) => boolean;
  skip?: (rel: string) => boolean;
  /** Which source files are scanned: components (`.tsx`, the default) or data modules (`.ts`). */
  files?: "tsx" | "ts";
};

const PATTERNS: Pattern[] = [
  {
    name: "raw search input (use ui/SearchInput)",
    home: /^components\/ui\//,
    hit: (l) => /type="search"/.test(l),
  },
  {
    name: "hand-rolled tab (use ui/Tabs)",
    home: /^components\/ui\//,
    hit: (l) => /role="tab"/.test(l),
  },
  {
    name: "hand-rolled chip (use ui/Chip)",
    home: /^components\/ui\//,
    hit: (l) => /rounded-full/.test(l) && /\bpx-[0-9.]+/.test(l),
  },
  {
    name: "inline svg (use <Icon>)",
    home: /^components\/ui\//,
    hit: (l) => /<svg\b/.test(l),
    skip: (rel) => ILLUSTRATION_SVG.has(rel),
  },
  {
    name: "emoji used as an icon (use <Icon>)",
    home: /^components\/ui\//,
    hit: (l) => EMOJI.test(l),
    skip: (rel) =>
      // The picker is a list of emoji; the journal's hints name the emoji a note takes; the
      // certificate is printed artwork (SVG text), not interface.
      /emojiPicker|EmojiPicker|pages\/DesignPage|Trips\/JournalEntryModal|FlightCertificate/.test(
        rel
      ),
  },
  {
    // A catalogue (purposes, domains, categories) that stores an emoji is rendered as an icon by
    // whatever reads it -- so the emoji is the bug, whichever file draws it. Map names to <Icon>.
    name: "emoji in a data catalogue (store an IconName, render <Icon>)",
    home: /^components\/ui\//,
    files: "ts",
    hit: (l) => EMOJI.test(l),
    // whatsNew is release-note copy. shared/placeCategories.ts holds the custom-category glyphs
    // the server stores as sent (wire values); every screen maps them to <Icon> (PLACE_GLYPH_ICON).
    skip: (rel) => /^content\/whatsNew|^shared\/placeCategories\.ts$/.test(rel),
  },
  {
    name: "domain emoji drawn as an icon (use DOMAIN_ICON + <Icon>)",
    home: /^components\/ui\//,
    hit: (l) => /DOMAINS\[[^\]]*\]\.icon\b/.test(l),
  },
  {
    name: "sort arrow glyph (use ui/SortButton)",
    home: /^components\/ui\//,
    hit: (l) => /[▲▼]/.test(l),
  },
  {
    name: "raw table (use ui/Table, or sort it with useSort)",
    home: /^components\/ui\//,
    hit: (l) => /<table\b/.test(l),
    skip: (rel) => rel in RAW_TABLE_REASON,
  },
];

function scan(): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    for (const pattern of PATTERNS) {
      if (pattern.home.test(rel) || pattern.skip?.(rel)) continue;
      if ((pattern.files ?? "tsx") !== (rel.endsWith(".tsx") ? "tsx" : "ts")) continue;
      const count = lines.filter((l) => CODE_LINE(l) && pattern.hit(l)).length;
      if (count > 0) (result[pattern.name] ??= {})[rel] = count;
    }
  }
  return result;
}

function readBaseline(): Record<string, Record<string, number>> {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, Record<string, number>>;
}

describe("one shared component per UI pattern", () => {
  const found = scan();
  let baseline = readBaseline();

  if (process.env.UI_PATTERNS_UPDATE === "1") {
    const next: Record<string, Record<string, number>> = {};
    for (const [pattern, files] of Object.entries(found)) {
      for (const [file, count] of Object.entries(files)) {
        const allowed = baseline[pattern]?.[file];
        // An empty baseline is the one time it may be written upward: its first run.
        if (Object.keys(baseline).length > 0 && (allowed === undefined || count > allowed)) {
          throw new Error(`Refusing to raise the baseline: ${pattern} in ${file} (${count})`);
        }
        (next[pattern] ??= {})[file] = count;
      }
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    baseline = readBaseline();
  }

  for (const pattern of PATTERNS) {
    it(`${pattern.name}: no new occurrence`, () => {
      const offenders = Object.entries(found[pattern.name] ?? {}).filter(
        ([file, count]) => count > (baseline[pattern.name]?.[file] ?? 0)
      );
      expect(offenders, `new hand-built occurrences of: ${pattern.name}`).toEqual([]);
    });

    it(`${pattern.name}: the baseline only shrinks`, () => {
      const stale = Object.entries(baseline[pattern.name] ?? {}).filter(
        ([file, allowed]) => (found[pattern.name]?.[file] ?? 0) < allowed
      );
      expect(
        stale,
        "fewer occurrences than the baseline records; lower it with UI_PATTERNS_UPDATE=1"
      ).toEqual([]);
    });
  }
});
