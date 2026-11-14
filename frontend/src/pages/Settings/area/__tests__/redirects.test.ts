import { describe, expect, it } from "vitest";
import { resolveAddress, type AddressInput } from "../redirects";
import { AREA_PAGES, validAnchors } from "../areaModel";
import { SECTION_ALIASES, REMOVED_PAGES } from "../../settingsModel";
import { ADMIN_PAGES } from "../../../Admin/adminSections";

/**
 * Every row of design §6 (`Einstellungen-Konzept.md`): old address -> new
 * address, in the order path?query#hash. The tables are the specification, so
 * they are copied here row by row rather than derived from the code under test.
 */
const resolve = (
  address: string,
  options: Partial<Pick<AddressInput, "isAdmin" | "isDomainOn" | "lastPage">> = {}
): ReturnType<typeof resolveAddress> => {
  const url = new URL(address, "http://x");
  return resolveAddress({
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    isAdmin: options.isAdmin ?? true,
    isDomainOn: options.isDomainOn ?? (() => true),
    lastPage: options.lastPage ?? null,
  });
};

/** §6.1, "Adressen aus dem Auftrag": [old, new]. */
const TABLE_6_1: ReadonlyArray<readonly [string, string]> = [
  ["/settings/account#profile", "/settings/profil#profile"],
  ["/settings/account#security", "/settings/profil#security"],
  ["/settings/account#devices", "/settings/telefone#devices"],
  ["/settings/account#notifications", "/settings/erinnerungen"],
  ["/settings/account#apitokens", "/settings/profil#apitokens"],
  ["/settings/display#display", "/settings/anzeige#language"],
  ["/settings/display#units", "/settings/anzeige#units"],
  ["/settings/display#domains", "/settings/reisearten#domains"],
  ["/settings/display#countryCounting", "/settings/reisearten#countryCounting"],
  ["/settings/views#mapAppearance", "/dashboard?panel=routes"],
  ["/settings/views#dashboardAppearance", "/dashboard"],
  ["/settings/views#listAppearance", "/flights"],
  ["/settings/trips#trips", "/settings/reisen#trips"],
  ["/settings/trips#suggestions", "/settings/reisen#suggestions"],
  ["/settings/trips#sharing", "/settings/freunde#accounts"],
  ["/settings/trips#calendarFeed", "/settings/reisen#calendarFeed"],
  ["/settings/companions#companions", "/settings/freunde#companions"],
  // The Standort page became TravTrack (web redesign, 2026-11-05).
  ["/settings/location", "/settings/tt-aufz"],
  ["/settings/location?tab=location", "/settings/tt-aufz"],
  ["/settings/location#locationProvider", "/settings/tt-aufz#ttRecording"],
  ["/settings/location#travTrack", "/settings/tt-aufz#ttZones"],
  ["/settings/location#history", "/settings/tt-daten#ttSources"],
  ["/settings/location#dawarich", "/settings/dienstek?service=dawarich"],
  ["/settings/location#tripRecording", "/settings/tt-aufz?match=aufz#ttRecording"],
  ["/settings/location#stayScan", "/settings/tt-erk"],
  ["/settings/travtrack#ttPlaces", "/settings/tt-aufz#ttPlaces"],
  ["/settings/travtrack#stayScan", "/settings/tt-erk"],
  ["/settings/loyalty#loyalty", "/settings/treue"],
  ["/settings/privacy#shareLinks", "/settings/freunde#shareLinks"],
  ["/settings/privacy#comparisonConsent", "/settings/freunde?match=rangliste#compare"],
  ["/settings/privacy#encryptedGrants", "/settings/freunde?match=verschl#encryptedGrants"],
  ["/settings/flight#homeAirport", "/settings/reisearten#homeAirport"],
  ["/settings/flight#autoupdate", "/settings/fluege#autoupdate"],
  ["/settings/flight#features", "/settings/fluege#features"],
  ["/settings/flight#defaults", "/settings/fluege#defaults"],
  ["/settings/flight#enrichment", "/settings/fluege#enrichment"],
  ["/settings/cruise#cruisePreferences", "/settings/kreuzfahrten"],
  ["/settings/data#backup", "/settings/daten#backup"],
  ["/settings/data#import", "/settings/daten#import"],
  ["/settings/services#externalServices", "/settings/dienstek"],
  ["/admin/instance#instance", "/settings/allgemein#general"],
  ["/admin/instance#travTrack", "/settings/tt-bereit?match=ttoffer"],
  ["/admin/instance#travPlan", "/settings/pl-bereit?match=tpoffer"],
  ["/admin/instance#shareLinks", "/settings/funktionen?match=linkserlaubt#sharing"],
  ["/admin/instance#importMode", "/settings/funktionen?match=importmodus#features"],
  ["/admin/instance#usageStats", "/settings/datenschutz#stats"],
  ["/admin/instance#about", "/settings/ueber"],
  ["/admin/instance#federation", "/settings/funktionen?match=fedon#sharing"],
  ["/admin/instance#push", "/settings/datenschutz#push"],
  ["/admin/users", "/settings/nutzer#accounts"],
  ["/admin/users?user=u-42", "/settings/nutzer?user=u-42#accounts"],
  ["/admin/invitations", "/settings/nutzer#invitations"],
  ["/admin/externalServices", "/settings/dienste"],
  ["/admin/externalServices?service=immich", "/settings/dienste?service=immich"],
  ["/admin/parsers#parsers", "/settings/buchungen"],
  ["/admin/parsers", "/settings/buchungen"],
  ["/admin/parsers#templateRepo", "/settings/eigene?match=tplrepo"],
  ["/admin/smtp", "/settings/email"],
  ["/admin/backups#backups", "/settings/sicherungen"],
  ["/admin/backups", "/settings/sicherungen"],
  ["/admin/backups#webdav", "/settings/dienste?service=webdav"],
  ["/admin/timeModel", "/settings/wartung#timeModel"],
  ["/admin/logging", "/settings/wartung#logging"],
  ["/admin/system", "/settings/wartung#system"],
  ["/admin/airlinesMasterData", "/settings/stamm?match=md_airlines#airlinesMasterData"],
  ["/admin/aircraftMasterData", "/settings/stamm?match=md_aircraft#aircraftMasterData"],
  ["/admin/airportsMasterData", "/settings/stamm?match=md_airports#airportsMasterData"],
  ["/admin/shipsMasterData", "/settings/stamm?match=md_ships#shipsMasterData"],
  ["/admin/portsMasterData", "/settings/stamm?match=md_ports#portsMasterData"],
  ["/admin/lodgingChainsMasterData", "/settings/stamm?match=md_chains#chains"],
];

/** §6.2, "Weitere Adressen, die der Router heute kennt" (as an admin). */
const TABLE_6_2: ReadonlyArray<readonly [string, string]> = [
  ["/settings", "/settings/reisearten"],
  ["/settings?section=units", "/settings/anzeige#units"],
  ["/settings#profile", "/settings/profil#profile"],
  ["/settings?tab=cruise", "/settings/kreuzfahrten"],
  ["/settings?tab=flight", "/settings/fluege"],
  ["/settings?section=apiKeys", "/settings/dienstek"],
  ["/settings?section=apikeys", "/settings/dienstek"],
  ["/settings?section=lodgingMemberships", "/settings/treue"],
  ["/settings?section=flightMemberships", "/settings/treue"],
  ["/settings?section=cruiseMemberships", "/settings/treue"],
  ["/settings?section=domainColors", "/settings/reisearten#domains"],
  ["/settings?section=modules", "/settings/reisearten#domains"],
  ["/settings#modules", "/settings/reisearten#domains"],
  ["/settings?section=about", "/settings/ueber"],
  ["/settings?section=lodgingPreferences", "/settings/eigene?match=photon"],
  ["/settings/lodging", "/settings/eigene?match=photon"],
  ["/settings?tab=lodging", "/settings/eigene?match=photon"],
  ["/settings?section=admin", "/settings/allgemein"],
  ["/settings/services?service=immich", "/settings/dienstek?service=immich"],
  [
    "/settings/flight?match=airports&expert=1#homeAirport",
    "/settings/reisearten?match=airports&expert=1#homeAirport",
  ],
  ["/admin", "/settings/allgemein"],
  ["/admin?tab=general", "/settings/allgemein"],
  ["/admin?tab=flight", "/settings/stamm?match=md_airlines#airlinesMasterData"],
  ["/admin?tab=cruise", "/settings/stamm?match=md_ships#shipsMasterData"],
  ["/admin?section=cruiseMasterData", "/settings/stamm?match=md_ships#shipsMasterData"],
  [
    "/admin?section=airlineAircraftMasterData",
    "/settings/stamm?match=md_airlines#airlinesMasterData",
  ],
  ["/admin?section=apiKeys", "/settings/dienste"],
  ["/admin/externalServices?section=apikeys", "/settings/dienste"],
  ["/admin?section=geocoder", "/settings/eigene?match=photon"],
  // Pre-page links the old admin router resolved by tab and section.
  ["/admin?tab=general&section=logging", "/settings/wartung#logging"],
  ["/admin?tab=general&section=users", "/settings/nutzer#accounts"],
];

describe("every address of design §6.1 lands where the table says", () => {
  it.each(TABLE_6_1)("%s -> %s", (old, expected) => {
    expect(resolve(old).to).toBe(expected);
  });
});

describe("every address of design §6.2 lands where the table says", () => {
  it.each(TABLE_6_2)("%s -> %s", (old, expected) => {
    expect(resolve(old).to).toBe(expected);
  });

  it("sends a non-admin's lodging address to the display page, and ?section=admin to the account", () => {
    const own = { isAdmin: false };
    expect(resolve("/settings?section=lodgingPreferences", own).to).toBe("/settings/anzeige");
    expect(resolve("/settings/lodging", own).to).toBe("/settings/anzeige");
    expect(resolve("/settings?section=admin", own).to).toBe("/settings/profil");
  });

  it("returns a bare /settings to the page last visited, falling back to Reisearten", () => {
    expect(resolve("/settings", { lastPage: "kreuzfahrten" }).to).toBe("/settings/kreuzfahrten");
    expect(resolve("/settings", { lastPage: "no-such-page" }).to).toBe("/settings/reisearten");
  });

  it("falls back to /flights only while flights are on, else to the dashboard", () => {
    const off = { isDomainOn: () => false };
    expect(resolve("/settings/views#listAppearance", off).to).toBe("/dashboard");
  });

  it("treats a malformed escape in the hash as no section, instead of throwing", () => {
    expect(resolve("/settings/profil#%").to).toBe("/settings/profil");
    expect(resolve("/admin/instance#%E0%A4%A").to).toBe("/settings/allgemein#general");
  });

  it("sends an unknown page to the profile page rather than rendering an empty frame", () => {
    expect(resolve("/settings/nonsense").to).toBe("/settings/profil");
  });

  it("keeps a switched-off domain's section in the address (the page says it is off)", () => {
    expect(
      resolve("/settings/kreuzfahrten#cruisePreferences", { isDomainOn: () => false }).to
    ).toBe("/settings/kreuzfahrten");
  });
});

describe("a page without a place in the account's own settings", () => {
  const own = { isAdmin: false };

  it.each([
    "/settings/allgemein",
    "/settings/nutzer#accounts",
    "/settings/wartung",
    "/settings/stamm",
    "/admin/users",
    "/admin/logging",
    "/admin/instance#instance",
    "/admin/airlinesMasterData",
  ])("sends a non-admin from %s to the account page and says why", (address) => {
    expect(resolve(address, own)).toEqual({ to: "/settings/profil", adminOnly: true });
  });

  it("sends a non-admin's backups address to the data page, where the status is", () => {
    expect(resolve("/admin/backups", own)).toEqual({ to: "/settings/daten", adminOnly: true });
  });

  it("lets everyone open About, and says nothing", () => {
    expect(resolve("/admin/instance#about", own)).toEqual({
      to: "/settings/ueber",
      adminOnly: false,
    });
  });

  it("says nothing on an admin's own address", () => {
    expect(resolve("/admin/users").adminOnly).toBe(false);
  });
});

describe("the canonical address is a fixed point", () => {
  const all = [...TABLE_6_1, ...TABLE_6_2].map(([old]) => old);

  it.each(all)("%s resolves to an address that resolves to itself", (old) => {
    const first = resolve(old).to;
    if (!first.startsWith("/settings")) return; // left the area: the map, the table
    expect(resolve(first).to).toBe(first);
  });

  it("holds for every anchor of every page of the area", () => {
    for (const page of AREA_PAGES) {
      for (const anchor of validAnchors(page.id)) {
        // The only mount of a page, by its own name, is the page itself.
        if (page.sections.length === 1 && anchor === page.sections[0].id) continue;
        const address = `/settings/${page.id}#${anchor}`;
        expect(resolve(address).to, address).toBe(address);
      }
    }
  });
});

describe("every id the old tables ever held still lands somewhere", () => {
  it("resolves each old admin page and section into the area", () => {
    for (const page of ADMIN_PAGES) {
      for (const section of page.sections) {
        const to = resolve(`/admin/${page.id}?section=${section.id}`).to;
        expect(to, `${page.id}/${section.id}`).toMatch(/^\/settings\/[a-z-]+/);
      }
    }
  });

  it("resolves each renamed section id and removed page", () => {
    for (const alias of Object.keys(SECTION_ALIASES)) {
      expect(resolve(`/settings?section=${alias}`).to, alias).toMatch(/^\/settings\//);
    }
    for (const removed of Object.keys(REMOVED_PAGES)) {
      expect(resolve(`/settings/${removed}`).to, removed).toMatch(/^\/settings\//);
    }
  });

  it("keeps the map's range on the way to the TravTrack settings, and only there", () => {
    expect(resolve("/settings/tt-daten?from=2026-11-01&until=2026-11-04").to).toBe(
      "/settings/tt-daten?from=2026-11-01&until=2026-11-04"
    );
    expect(resolve("/settings/travtrack?from=2026-11-01&until=2026-11-04").to).toBe(
      "/settings/tt-aufz?from=2026-11-01&until=2026-11-04"
    );
    expect(resolve("/settings/location?from=2026-11-01&until=2026-11-04").to).toContain(
      "from=2026-11-01&until=2026-11-04"
    );
    expect(resolve("/settings/display?from=2026-11-01").to).not.toContain("from=");
  });
});

/**
 * Settings v3, phase S1: the old page names (`/settings/<page>`) are bookmarks,
 * issue bodies and changelog links. Each lands on the page its content moved to.
 */
describe("every page of the settings area before settings v3 still opens", () => {
  const OLD_PAGES: ReadonlyArray<readonly [string, string]> = [
    ["account", "profil"],
    ["display", "anzeige"],
    ["domains", "reisearten"],
    ["flight", "fluege"],
    ["cruise", "kreuzfahrten"],
    ["trips", "reisen"],
    ["sharing", "freunde"],
    ["notifications", "erinnerungen"],
    ["travtrack", "tt-aufz"],
    ["loyalty", "treue"],
    ["data", "daten"],
    ["services", "dienstek"],
    ["server", "allgemein"],
    ["users", "nutzer"],
    ["backups", "sicherungen"],
    ["maintenance", "wartung"],
    ["masterdata", "stamm"],
    ["about", "ueber"],
  ];

  it.each(OLD_PAGES)("/settings/%s -> /settings/%s", (old, now) => {
    expect(resolve(`/settings/${old}`).to).toBe(`/settings/${now}`);
  });

  it("keeps a section the old page had on the page that now draws it", () => {
    // `features` was a section of two old pages (Flüge and Server): the page names the owner.
    expect(resolve("/settings/server#features").to).toBe("/settings/funktionen#features");
    expect(resolve("/settings/flight#features").to).toBe("/settings/fluege#features");
    expect(resolve("/settings/account#home").to).toBe("/settings/reisearten#home");
    expect(resolve("/settings/data#export").to).toBe("/settings/daten#export");
    expect(resolve("/settings/domains#planning").to).toBe("/settings/pl-plan");
  });

  it("lets a named row decide between the pages an old page split into", () => {
    expect(resolve("/settings/sharing?match=linkserlaubt#shareLinks").to).toBe(
      "/settings/funktionen?match=linkserlaubt#sharing"
    );
    expect(resolve("/settings/server?match=importmodus#features").to).toBe(
      "/settings/funktionen?match=importmodus#features"
    );
  });

  it("reads an old page named as ?tab= the same way", () => {
    expect(resolve("/settings?tab=server#features").to).toBe("/settings/funktionen#features");
    expect(resolve("/settings?tab=flight#features").to).toBe("/settings/fluege#features");
  });

  it("keeps the catalogue's card and the user filter on their pages", () => {
    expect(resolve("/settings/services?service=immich").to).toBe(
      "/settings/dienstek?service=immich"
    );
    expect(resolve("/settings/users?user=u-1").to).toBe("/settings/nutzer?user=u-1");
  });

  it("finds the addresses and the passkeys on the page they got in settings v3 S5", () => {
    expect(resolve("/settings/server#addresses").to).toBe("/settings/adressen");
    expect(resolve("/settings/server#passkeys").to).toBe("/settings/adressen#passkeys");
  });

  it("reads a card named by the old hash like one named by ?service= (Codex, rc.29 review)", () => {
    expect(resolve("/settings/services#geocoder").to).toBe("/settings/eigene?match=photon");
    expect(resolve("/settings/services#selfHostedRouting").to).toBe("/settings/eigene?match=osrm");
    expect(resolve("/settings/services#federation").to).toBe(
      "/settings/funktionen?match=fedon#sharing"
    );
    expect(resolve("/settings/services#immich").to).toBe("/settings/dienstek?service=immich");
    // The exchange-rate card is gone; its setting is a row of its own.
    expect(resolve("/settings/services?service=fx").to).toBe("/settings/eigene?match=fxsrc");
  });

  it("sends a card that has a page of its own there, and a server-only card to the server's page", () => {
    // A bookmark of the catalogue's geocoder or mail card from before the split.
    expect(resolve("/settings/dienstek?service=geocoder").to).toBe("/settings/eigene?match=photon");
    expect(resolve("/settings/dienstek?service=smtp").to).toBe("/settings/email");
    expect(resolve("/settings/dienstek?service=push").to).toBe("/settings/datenschutz#push");
    // A card the account has nothing to set on goes to the server's half for an admin ...
    expect(resolve("/settings/dienstek?service=aeroapi").to).toBe(
      "/settings/dienste?service=aeroapi"
    );
    // ... and for anyone else loses the card name rather than the page.
    expect(resolve("/settings/dienstek?service=aeroapi", { isAdmin: false }).to).toBe(
      "/settings/dienstek"
    );
    // An account's own card stays.
    expect(resolve("/settings/dienstek?service=gemini").to).toBe(
      "/settings/dienstek?service=gemini"
    );
  });

  it("opens every new page as it is, for an admin", () => {
    for (const page of AREA_PAGES) {
      expect(resolve(`/settings/${page.id}`).to, page.id).toBe(`/settings/${page.id}`);
    }
  });
});
