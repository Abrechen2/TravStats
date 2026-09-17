export type ActiveSection =
  | "users"
  | "invitations"
  | "system"
  | "instance"
  | "parsers"
  | "logging"
  | "backups"
  | "externalServices"
  | "smtp"
  | "shipsMasterData"
  | "portsMasterData"
  | "airlinesMasterData"
  | "aircraftMasterData"
  | "airportsMasterData";

export type TabId = "general" | "flight" | "cruise";

// Which tab each admin section belongs to. Everything falls in "general"
// unless it's inherently domain-specific. The parser config (Ollama URL /
// model, OCR/regex defaults) is cross-domain — the cruise parser depends on
// the same Ollama endpoint as flights — so it lives under "general", not
// "flight" (where cruise-only users never found it; see issue #129).
// Master data is one sub-section per catalogue — ships and ports under the
// cruise tab, airlines / aircraft / airports under the flight tab. They used
// to be two combined pages ("Schiffe & Häfen", "Airlines & Flugzeuge") that
// stacked every catalogue on one screen; the lists are long enough that
// finding anything meant scrolling past the one above it. Old deep links
// still resolve — see sectionAliases.
export const TAB_FOR_SECTION: Record<ActiveSection, TabId> = {
  system: "general",
  instance: "general",
  users: "general",
  invitations: "general",
  externalServices: "general",
  logging: "general",
  backups: "general",
  smtp: "general",
  parsers: "general",
  shipsMasterData: "cruise",
  portsMasterData: "cruise",
  airlinesMasterData: "flight",
  aircraftMasterData: "flight",
  airportsMasterData: "flight",
};

/**
 * Sections whose body fetches its own data on mount (either the section
 * component itself, or an `onVisible` callback AdminPage wires up for it —
 * see AdminSectionSwitch / LazySection). Round 4 made every section of the
 * active tab render at once instead of only the picked one; without this
 * list, opening the admin page would fire ships/ports/airlines/aircraft/
 * airports/instance/backups/WebDAV/SMTP/logging/global-API-key/Immich
 * requests all at the same time, most of which the user never asked to see.
 * `LazySection` defers a listed section's real content until it has been
 * near the viewport at least once; unlisted sections (system, users,
 * invitations, parsers) already load unconditionally today via AdminPage's
 * own `loadData()`, so there is nothing to save by deferring them.
 */
export const LAZY_ADMIN_SECTIONS: ReadonlySet<ActiveSection> = new Set([
  "instance",
  "backups",
  "smtp",
  "externalServices",
  "logging",
  "shipsMasterData",
  "portsMasterData",
  "airlinesMasterData",
  "aircraftMasterData",
  "airportsMasterData",
]);
