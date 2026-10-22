import { describe, expect, it } from "vitest";
import { resolveAdminLink, resolveSettingsLink } from "../settingsLinks";
import { SETTINGS_PAGES } from "../settingsModel";
import { ADMIN_PAGES } from "../../Admin/adminSections";

/**
 * forgejo#321 acceptance: "Every old settings and admin deep link lands on the
 * right page and section." These tables are every id the two surfaces ever
 * answered to — the section ids of 2.7.0's settings model, its aliases, the
 * admin's section ids and aliases, and the old `?tab=` values — each resolved
 * through every address shape that was ever written.
 */

/** Old personal section id → where it lives now (for an account that is no admin). */
const OLD_SETTINGS: Record<string, string> = {
  profile: "/settings/account?section=profile",
  security: "/settings/account?section=security",
  apitokens: "/settings/account?section=apitokens",
  devices: "/settings/account?section=devices",
  notifications: "/settings/account?section=notifications",
  display: "/settings/display?section=display",
  units: "/settings/display?section=units",
  domainColors: "/settings/display?section=domains",
  modules: "/settings/display?section=domains",
  countryCounting: "/settings/display?section=countryCounting",
  trips: "/settings/trips?section=trips",
  loyalty: "/settings/loyalty?section=loyalty",
  lodgingMemberships: "/settings/loyalty?section=loyalty",
  flightMemberships: "/settings/loyalty?section=loyalty",
  cruiseMemberships: "/settings/loyalty?section=loyalty",
  backup: "/settings/data?section=backup",
  import: "/settings/data?section=import",
  externalServices: "/settings/services?section=externalServices",
  apiKeys: "/settings/services?section=externalServices",
  apikeys: "/settings/services?section=externalServices",
  homeAirport: "/settings/flight?section=homeAirport",
  defaults: "/settings/flight?section=defaults",
  features: "/settings/flight?section=features",
  enrichment: "/settings/flight?section=enrichment",
  autoupdate: "/settings/flight?section=autoupdate",
  cruisePreferences: "/settings/cruise?section=cruisePreferences",
  // Moved to Administration › Instanz; an account without it is told so
  // (lodgingPreferences) or finds the version under the menu (about).
  lodgingPreferences: "/settings/account?section=lodgingPreferences",
  about: "/settings/account",
  admin: "/settings/account",
};

/** The same ids opened by an admin, where they differ. */
const OLD_SETTINGS_ADMIN: Record<string, string> = {
  ...OLD_SETTINGS,
  lodgingPreferences: "/admin/instance?section=geocoder",
  about: "/admin/instance?section=about",
  admin: "/admin",
};

const OLD_GROUPS = [
  "account",
  "display",
  "trips",
  "loyalty",
  "data",
  "services",
  "flight",
  "cruise",
  "lodging",
];
const allOn = (): boolean => true;

/**
 * A section that moved to administration, opened by an account without it,
 * is explained on the page the link named rather than on a different one.
 */
const stayingOn = (target: string, page: string, isAdmin: boolean, id: string): string => {
  if (isAdmin || !["about", "lodgingPreferences"].includes(id) || page === "lodging") {
    return target;
  }
  return target.replace("/settings/account", `/settings/${page}`);
};

const settings = (
  input: Partial<Parameters<typeof resolveSettingsLink>[0]>
): ReturnType<typeof resolveSettingsLink> =>
  resolveSettingsLink({
    page: undefined,
    section: null,
    tab: null,
    isAdmin: false,
    isReachable: allOn,
    ...input,
  });

describe("old personal settings links", () => {
  for (const [isAdmin, table] of [
    [false, OLD_SETTINGS],
    [true, OLD_SETTINGS_ADMIN],
  ] as const) {
    describe(isAdmin ? "for an admin" : "for an account without admin rights", () => {
      it.each(Object.entries(table))("lands ?section=%s on %s", (id, target) => {
        expect(settings({ section: id, isAdmin })).toBe(target);
        // The hash form is read into `section` by the page, as the query is.
        for (const page of OLD_GROUPS) {
          expect(settings({ page, section: id, isAdmin })).toBe(
            stayingOn(target, page, isAdmin, id)
          );
        }
        expect(settings({ section: id, tab: "flight", isAdmin })).toBe(target);
      });
    });
  }

  it.each([
    ["general", "/settings/account"],
    ["flight", "/settings/flight"],
    ["cruise", "/settings/cruise"],
    ["lodging", "/settings/account?section=lodgingPreferences"],
  ])("lands a bare ?tab=%s on %s", (tab, target) => {
    expect(settings({ tab })).toBe(target);
  });

  /** Pages that no longer exist, and the section that took their content. */
  const REMOVED_PAGES: Record<string, { admin: string; user: string }> = {
    // Its one section, the geocoder, moved to Administration › Instanz.
    lodging: {
      admin: "/admin/instance?section=geocoder",
      user: "/settings/account?section=lodgingPreferences",
    },
  };

  it.each(OLD_GROUPS.map((g) => [g]))("keeps /settings/%s working as a page", (group) => {
    const removed = REMOVED_PAGES[group];
    expect(settings({ page: group })).toBe(removed ? removed.user : `/settings/${group}`);
    expect(settings({ page: group, isAdmin: true })).toBe(
      removed ? removed.admin : `/settings/${group}`
    );
  });

  it("covers every page the old tables had that today's has not", () => {
    const today = new Set(SETTINGS_PAGES.map((p) => p.id as string));
    expect(OLD_GROUPS.filter((g) => !today.has(g))).toEqual(Object.keys(REMOVED_PAGES));
  });

  it("answers every section of today's table with its own page", () => {
    for (const page of SETTINGS_PAGES) {
      for (const section of page.sections) {
        expect(settings({ section: section.id })).toBe(
          `/settings/${page.id}?section=${section.id}`
        );
      }
    }
  });

  // forgejo#321 prototype: the page of a switched-off domain says so and
  // offers the switch, rather than a bookmark landing on the account page.
  it("keeps a domain page whose domain is off as an address, without its section", () => {
    const flightOff = (p: { domain?: string }): boolean => p.domain !== "flight";
    expect(settings({ page: "flight", isReachable: flightOff })).toBe("/settings/flight");
    expect(settings({ section: "homeAirport", isReachable: flightOff })).toBe("/settings/flight");
    expect(settings({ tab: "flight", isReachable: flightOff })).toBe("/settings/flight");
  });

  it("answers an unknown page or section with the default page, never an empty frame", () => {
    expect(settings({ page: "does-not-exist" })).toBe("/settings/account");
    expect(settings({ page: "flight", section: "constructor" })).toBe("/settings/flight");
  });
});

/** Old admin section id or alias → its page now. */
const OLD_ADMIN: Record<string, string> = {
  system: "/admin/system",
  instance: "/admin/instance",
  users: "/admin/users",
  invitations: "/admin/invitations",
  externalServices: "/admin/externalServices",
  apiKeys: "/admin/externalServices",
  parsers: "/admin/parsers",
  logging: "/admin/logging",
  backups: "/admin/backups",
  timeModel: "/admin/timeModel",
  smtp: "/admin/smtp",
  shipsMasterData: "/admin/shipsMasterData",
  portsMasterData: "/admin/portsMasterData",
  cruiseMasterData: "/admin/shipsMasterData",
  airlinesMasterData: "/admin/airlinesMasterData",
  aircraftMasterData: "/admin/aircraftMasterData",
  airportsMasterData: "/admin/airportsMasterData",
  airlineAircraftMasterData: "/admin/airlinesMasterData",
};

const admin = (
  input: Partial<Parameters<typeof resolveAdminLink>[0]>
): ReturnType<typeof resolveAdminLink> =>
  resolveAdminLink({
    page: undefined,
    section: null,
    tab: null,
    user: null,
    isReachable: allOn,
    ...input,
  });

describe("old admin links", () => {
  it.each(Object.entries(OLD_ADMIN))("lands ?section=%s on %s", (id, target) => {
    expect(admin({ section: id })).toBe(target);
    for (const tab of ["general", "flight", "cruise"]) {
      expect(admin({ tab, section: id })).toBe(target);
    }
  });

  it.each([
    ["general", "/admin/instance"],
    ["flight", "/admin/airlinesMasterData"],
    ["cruise", "/admin/shipsMasterData"],
    // Written as a tab by the bus routing note.
    ["externalServices", "/admin/externalServices"],
  ])("lands a bare ?tab=%s on %s", (tab, target) => {
    expect(admin({ tab })).toBe(target);
  });

  it("keeps ?user= on a link into user management", () => {
    expect(admin({ tab: "general", section: "users", user: "u-1" })).toBe("/admin/users?user=u-1");
  });

  it("keeps a page's first section, and the expert request, when a link asks for its expert rows", () => {
    expect(admin({ page: "instance", section: "instance", expert: true })).toBe(
      "/admin/instance?section=instance&expert=1"
    );
    expect(admin({ section: "parsers", expert: true })).toBe(
      "/admin/parsers?section=parsers&expert=1"
    );
    expect(admin({ page: "instance", section: "instance" })).toBe("/admin/instance");
  });

  it("keeps a section that is not the page's first one", () => {
    expect(admin({ page: "instance", section: "push" })).toBe("/admin/instance?section=push");
    expect(admin({ section: "geocoder" })).toBe("/admin/instance?section=geocoder");
  });

  it("answers every section of today's table with its page", () => {
    for (const page of ADMIN_PAGES) {
      for (const section of page.sections) {
        const expected =
          section.id === page.id ? `/admin/${page.id}` : `/admin/${page.id}?section=${section.id}`;
        expect(admin({ section: section.id })).toBe(expected);
      }
    }
  });

  it("keeps master data of a switched-off domain as an address that says so", () => {
    const cruiseOff = (p: { domain?: string }): boolean => p.domain !== "cruise";
    expect(admin({ page: "shipsMasterData", isReachable: cruiseOff })).toBe(
      "/admin/shipsMasterData"
    );
    expect(admin({ tab: "cruise", isReachable: cruiseOff })).toBe("/admin/shipsMasterData");
    expect(admin({ section: "portsMasterData", isReachable: cruiseOff })).toBe(
      "/admin/portsMasterData"
    );
  });
});
