import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * forgejo#88 acceptance, 2026-10-10: at 360px the flights page scrolled
 * sideways as a whole (scrollWidth 428) — its header's action group
 * ("Mehrere bearbeiten", "Spalten", "+ Flug hinzufügen", 404px together)
 * was the one logbook toolbar without `flex-wrap`. jsdom cannot measure a
 * row, so this reads the header of every logbook page: the group that
 * follows the page title must be allowed to wrap.
 */
const PAGES = [
  "FlightsTablePage",
  "CruisesPage",
  "LodgingListPage",
  "PlacesListPage",
  "RailPage",
  "BusPage",
  "RentalsPage",
];

const ACTIONS_AFTER_TITLE =
  /<h1 className="t-screen-title">[^\n]*\n(?:\s*\{\/\*[\s\S]*?\*\/\}\n)?\s*<div className="([^"]*)"/;

describe("logbook header actions wrap on a phone", () => {
  it.each(PAGES)("%s", (name) => {
    const source = readFileSync(resolve(__dirname, `../${name}.tsx`), "utf-8");
    const match = ACTIONS_AFTER_TITLE.exec(source);
    expect(match, `${name}: no action group after the title`).not.toBeNull();
    expect(match![1].split(/\s+/)).toContain("flex-wrap");
  });
});
