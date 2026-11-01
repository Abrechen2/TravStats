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
  ["/settings/account#profile", "/settings/account#profile"],
  ["/settings/account#security", "/settings/account#security"],
  ["/settings/account#devices", "/settings/account#devices"],
  ["/settings/account#notifications", "/settings/notifications"],
  ["/settings/account#apitokens", "/settings/account#apitokens"],
  ["/settings/display#display", "/settings/display#language"],
  ["/settings/display#units", "/settings/display#units"],
  ["/settings/display#domains", "/settings/domains#domains"],
  ["/settings/display#countryCounting", "/settings/domains#countryCounting"],
  ["/settings/views#mapAppearance", "/dashboard?panel=routes"],
  ["/settings/views#dashboardAppearance", "/dashboard"],
  ["/settings/views#listAppearance", "/flights"],
  ["/settings/trips#trips", "/settings/trips#trips"],
  ["/settings/trips#suggestions", "/settings/trips#suggestions"],
  ["/settings/trips#sharing", "/settings/sharing#accounts"],
  ["/settings/trips#calendarFeed", "/settings/trips#calendarFeed"],
  ["/settings/companions#companions", "/settings/sharing#companions"],
  ["/settings/location#locationProvider", "/settings/location#locationProvider"],
  ["/settings/location#travTrack", "/settings/location#travTrack"],
  ["/settings/location#dawarich", "/settings/services?service=dawarich"],
  ["/settings/location#tripRecording", "/settings/location?match=aufz#locationProvider"],
  ["/settings/location#stayScan", "/settings/location#stayScan"],
  ["/settings/loyalty#loyalty", "/settings/loyalty"],
  ["/settings/privacy#shareLinks", "/settings/sharing#shareLinks"],
  ["/settings/privacy#comparisonConsent", "/settings/sharing?match=rangliste#compare"],
  ["/settings/privacy#encryptedGrants", "/settings/sharing?match=verschl#compare"],
  ["/settings/flight#homeAirport", "/settings/flight#homeAirport"],
  ["/settings/flight#autoupdate", "/settings/flight#autoupdate"],
  ["/settings/flight#features", "/settings/flight#features"],
  ["/settings/flight#defaults", "/settings/flight#defaults"],
  ["/settings/flight#enrichment", "/settings/flight#enrichment"],
  ["/settings/cruise#cruisePreferences", "/settings/cruise#cruisePreferences"],
  ["/settings/data#backup", "/settings/data#backup"],
  ["/settings/data#import", "/settings/data#import"],
  ["/settings/services#externalServices", "/settings/services"],
  ["/admin/instance#instance", "/settings/server#general"],
  ["/admin/instance#travTrack", "/settings/server?match=ttoffer#features"],
  ["/admin/instance#travPlan", "/settings/server?match=tpoffer#features"],
  ["/admin/instance#shareLinks", "/settings/sharing?match=linkserlaubt#shareLinks"],
  ["/admin/instance#importMode", "/settings/server?match=importmodus#features"],
  ["/admin/instance#usageStats", "/settings/services?service=usageStats"],
  ["/admin/instance#about", "/settings/about"],
  ["/admin/instance#federation", "/settings/services?service=federation"],
  ["/admin/instance#push", "/settings/services?service=push"],
  ["/admin/users", "/settings/users#accounts"],
  ["/admin/users?user=u-42", "/settings/users?user=u-42#accounts"],
  ["/admin/invitations", "/settings/users#invitations"],
  ["/admin/externalServices", "/settings/services"],
  ["/admin/externalServices?service=immich", "/settings/services?service=immich"],
  ["/admin/parsers#parsers", "/settings/server#parsers"],
  ["/admin/parsers", "/settings/server#parsers"],
  ["/admin/parsers#templateRepo", "/settings/services?service=updatesTemplates"],
  ["/admin/smtp", "/settings/services?service=smtp"],
  ["/admin/backups#backups", "/settings/backups"],
  ["/admin/backups", "/settings/backups"],
  ["/admin/backups#webdav", "/settings/services?service=webdav"],
  ["/admin/timeModel", "/settings/maintenance#timeModel"],
  ["/admin/logging", "/settings/maintenance#logging"],
  ["/admin/system", "/settings/maintenance#system"],
  ["/admin/airlinesMasterData", "/settings/masterdata?match=md_airlines#catalogues"],
  ["/admin/aircraftMasterData", "/settings/masterdata?match=md_aircraft#catalogues"],
  ["/admin/airportsMasterData", "/settings/masterdata?match=md_airports#catalogues"],
  ["/admin/shipsMasterData", "/settings/masterdata?match=md_ships#catalogues"],
  ["/admin/portsMasterData", "/settings/masterdata?match=md_ports#catalogues"],
  ["/admin/lodgingChainsMasterData", "/settings/masterdata?match=md_chains#catalogues"],
];

/** §6.2, "Weitere Adressen, die der Router heute kennt" (as an admin). */
const TABLE_6_2: ReadonlyArray<readonly [string, string]> = [
  ["/settings", "/settings/domains"],
  ["/settings?section=units", "/settings/display#units"],
  ["/settings#profile", "/settings/account#profile"],
  ["/settings?tab=cruise", "/settings/cruise"],
  ["/settings?tab=flight", "/settings/flight"],
  ["/settings?section=apiKeys", "/settings/services"],
  ["/settings?section=apikeys", "/settings/services"],
  ["/settings?section=lodgingMemberships", "/settings/loyalty"],
  ["/settings?section=flightMemberships", "/settings/loyalty"],
  ["/settings?section=cruiseMemberships", "/settings/loyalty"],
  ["/settings?section=domainColors", "/settings/domains#domains"],
  ["/settings?section=modules", "/settings/domains#domains"],
  ["/settings#modules", "/settings/domains#domains"],
  ["/settings?section=about", "/settings/about"],
  ["/settings?section=lodgingPreferences", "/settings/services?service=geocoder&expert=1"],
  ["/settings/lodging", "/settings/services?service=geocoder&expert=1"],
  ["/settings?tab=lodging", "/settings/services?service=geocoder&expert=1"],
  ["/settings?section=admin", "/settings/server"],
  ["/settings/services?service=immich", "/settings/services?service=immich"],
  [
    "/settings/flight?match=airports&expert=1#homeAirport",
    "/settings/flight?match=airports&expert=1#homeAirport",
  ],
  ["/admin", "/settings/server"],
  ["/admin?tab=general", "/settings/server"],
  ["/admin?tab=flight", "/settings/masterdata?match=md_airlines#catalogues"],
  ["/admin?tab=cruise", "/settings/masterdata?match=md_ships#catalogues"],
  ["/admin?section=cruiseMasterData", "/settings/masterdata?match=md_ships#catalogues"],
  ["/admin?section=airlineAircraftMasterData", "/settings/masterdata?match=md_airlines#catalogues"],
  ["/admin?section=apiKeys", "/settings/services"],
  ["/admin/externalServices?section=apikeys", "/settings/services"],
  ["/admin?section=geocoder", "/settings/services?service=geocoder&expert=1"],
  // Pre-page links the old admin router resolved by tab and section.
  ["/admin?tab=general&section=logging", "/settings/maintenance#logging"],
  ["/admin?tab=general&section=users", "/settings/users#accounts"],
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
    expect(resolve("/settings?section=lodgingPreferences", own).to).toBe("/settings/display");
    expect(resolve("/settings/lodging", own).to).toBe("/settings/display");
    expect(resolve("/settings?section=admin", own).to).toBe("/settings/account");
  });

  it("returns a bare /settings to the page last visited, falling back to Reisearten", () => {
    expect(resolve("/settings", { lastPage: "cruise" }).to).toBe("/settings/cruise");
    expect(resolve("/settings", { lastPage: "no-such-page" }).to).toBe("/settings/domains");
  });

  it("falls back to /flights only while flights are on, else to the display page", () => {
    const off = { isDomainOn: () => false };
    expect(resolve("/settings/views#listAppearance", off).to).toBe("/settings/display#views");
  });

  it("treats a malformed escape in the hash as no section, instead of throwing", () => {
    expect(resolve("/settings/account#%").to).toBe("/settings/account");
    expect(resolve("/admin/instance#%E0%A4%A").to).toBe("/settings/server#general");
  });

  it("sends an unknown page to the account page rather than rendering an empty frame", () => {
    expect(resolve("/settings/nonsense").to).toBe("/settings/account");
  });

  it("keeps a switched-off domain's section in the address (the page says it is off)", () => {
    expect(resolve("/settings/cruise#cruisePreferences", { isDomainOn: () => false }).to).toBe(
      "/settings/cruise#cruisePreferences"
    );
  });
});

describe("a page without a place in the account's own settings", () => {
  const own = { isAdmin: false };

  it.each([
    "/settings/server",
    "/settings/users#accounts",
    "/settings/maintenance",
    "/settings/masterdata",
    "/admin/users",
    "/admin/logging",
    "/admin/instance#instance",
    "/admin/airlinesMasterData",
  ])("sends a non-admin from %s to the account page and says why", (address) => {
    expect(resolve(address, own)).toEqual({ to: "/settings/account", adminOnly: true });
  });

  it("sends a non-admin's backups address to the data page, where the status is", () => {
    expect(resolve("/admin/backups", own)).toEqual({ to: "/settings/data", adminOnly: true });
  });

  it("lets everyone open About, and says nothing", () => {
    expect(resolve("/admin/instance#about", own)).toEqual({
      to: "/settings/about",
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
        // A page's only section, of its own name, is the page itself.
        if (anchor === page.id && validAnchors(page.id).size === 1) continue;
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
        expect(to, `${page.id}/${section.id}`).toMatch(/^\/settings\/[a-z]+/);
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
});
