import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AREA_MENU, AREA_PAGES, findAreaPage, mountFor } from "../../area/areaModel";
import { pageLevel, pageReachable } from "../../surface";
import { SETTINGS_REGISTRY, expertRowCount, findableRows, registryPage } from "..";
import { DOMAIN_KEYS } from "../../../../shared/domains";
import { BETA_FEATURES } from "../../../../config/betaFeatures";

interface DesignRow {
  id: string;
  x?: number;
}
interface DesignSection {
  id: string;
  rows: DesignRow[];
}
interface DesignPage {
  id: string;
  s: DesignSection[];
}

/** The settings v3 page model, read from the repository: the registry must not drift from it. */
const design = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../docs/superpowers/specs/2026-11-11-settings-v3/settings-data.json"),
    "utf8"
  )
) as { pages: DesignPage[] };

describe("the settings registry follows the settings v3 page model", () => {
  it("holds every page, section and row of settings-data.json, in order", () => {
    expect(SETTINGS_REGISTRY.map((p) => p.id)).toEqual(design.pages.map((p) => p.id));
    for (const page of design.pages) {
      const mine = registryPage(page.id)!;
      expect(
        mine.sections.map((s) => s.id),
        page.id
      ).toEqual(page.s.map((s) => s.id));
      for (const section of page.s) {
        const sectionMine = mine.sections.find((s) => s.id === section.id)!;
        expect(
          sectionMine.rows.map((r) => r.id),
          `${page.id}/${section.id}`
        ).toEqual(section.rows.map((r) => r.id));
      }
    }
  });

  it("counts 33 pages, 115 groups and cards (38 of them service cards: 15 the account's, 23 the server's) and 267 rows", () => {
    const sections = SETTINGS_REGISTRY.flatMap((p) => p.sections);
    expect(SETTINGS_REGISTRY).toHaveLength(33);
    expect(sections).toHaveLength(115);
    expect(sections.filter((s) => s.serviceCategory)).toHaveLength(38);
    expect(registryPage("dienstek")!.sections).toHaveLength(15);
    expect(registryPage("dienste")!.sections).toHaveLength(23);
    expect(sections.flatMap((s) => s.rows)).toHaveLength(267);
  });

  it("lists the rows added after the first generation, so search can find them (forgejo#407)", () => {
    const ids = new Set(
      SETTINGS_REGISTRY.flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => r.id)))
    );
    for (const id of ["r_rental", "r_roadtrip", "r_poi", "enrich"])
      expect(ids.has(id), id).toBe(true);
    // Every reminder area the app offers has its row (one lead select each).
    const reminders = SETTINGS_REGISTRY.flatMap((p) => p.sections.flatMap((s) => s.rows)).filter(
      (r) => r.id.startsWith("r_")
    );
    expect(reminders.map((r) => r.id).sort()).toEqual(
      [
        "r_bus",
        "r_cruise",
        "r_ferry",
        "r_flight",
        "r_lodging",
        "r_poi",
        "r_rail",
        "r_rental",
        "r_roadtrip",
      ].sort()
    );
  });

  it("gives every row a stable id, unique within its page", () => {
    for (const page of SETTINGS_REGISTRY) {
      const ids = page.sections.flatMap((s) => s.rows.map((r) => r.id));
      expect(new Set(ids).size, page.id).toBe(ids.length);
    }
  });

  it("marks the explicit expert rows, and keeps an x:0 row standard inside an expert section", () => {
    for (const page of design.pages) {
      for (const section of page.s) {
        for (const row of section.rows) {
          const mine = registryPage(page.id)!
            .sections.find((s) => s.id === section.id)!
            .rows.find((r) => r.id === row.id)!;
          if (row.x === 1) expect(mine.level, row.id).toBe("expert");
          if (row.x === 0) expect(mine.level, row.id).toBe("standard");
        }
      }
    }
  });

  it("carries scope and audience: the server's pages are instance-wide and admin-only", () => {
    for (const id of [
      "allgemein",
      "nutzer",
      "funktionen",
      "email",
      "buchungen",
      "dienste",
      "sicherungen",
      "srvconn",
      "datenschutz",
      "adressen",
      "eigene",
      "wartung",
      "stamm",
    ]) {
      const page = registryPage(id)!;
      expect(page.audience, id).toBe("admin");
      for (const row of page.sections.flatMap((s) => s.rows)) {
        // The access card of the Konten page holds the server's switches only.
        expect(row.scope, `${id}/${row.id}`).toBe("instance");
        expect(row.audience, `${id}/${row.id}`).toBe("admin");
      }
    }
    // The service catalogue is two pages since settings v3 S5: the account's holds its own
    // keys and connections only, the server's holds the server's.
    const own = registryPage("dienstek")!;
    expect(own.audience).toBe("all");
    for (const row of own.sections.flatMap((s) => s.rows)) {
      expect(row.scope, row.id).toBe("account");
      expect(row.audience, row.id).toBe("all");
    }
    const opensky = registryPage("dienste")!.sections.find((s) => s.id === "opensky")!;
    expect(opensky.rows.every((r) => r.scope === "instance" && r.audience === "admin")).toBe(true);
    expect(
      registryPage("dienstek")!
        .sections.find((s) => s.id === "opensky")!
        .rows.map((r) => r.id)
    ).toEqual(["oskid", "osksec"]);
  });

  it("ties rows to real domains and real beta keys; tours and roadtrips are two domains", () => {
    const betaKeys = new Set(Object.keys(BETA_FEATURES));
    for (const page of SETTINGS_REGISTRY) {
      if (page.domain) expect(DOMAIN_KEYS).toContain(page.domain);
      for (const section of page.sections) {
        if (section.beta) expect(betaKeys.has(section.beta), section.id).toBe(true);
        for (const row of section.rows) {
          if (row.domain) expect(DOMAIN_KEYS).toContain(row.domain);
          if (row.beta) expect(betaKeys.has(row.beta), row.id).toBe(true);
        }
      }
    }
    // The switches themselves carry no domain: a switched-off type's own switch
    // must stay findable, or it could never be switched on from the search.
    const switches = registryPage("reisearten")!
      .sections.flatMap((s) => s.rows)
      .filter((r) => r.kind === "domain");
    expect(switches.map((r) => r.id)).toEqual([
      "d_flight",
      "d_cruise",
      "d_lodging",
      "d_rail",
      "d_bus",
      "d_ferry",
      "d_rental",
      "d_poi",
      "d_tour",
      "d_roadtrip",
    ]);
    for (const row of switches) expect(row.domain, row.id).toBeUndefined();
  });

  it("keeps the status default of new flights in 'Neue Flüge starten mit', expert like its neighbours (coordinator's call)", () => {
    const group = registryPage("fluege")!.sections.find(
      (s) => s.id === "fluege-neue-fluge-starten-mit"
    )!;
    expect(group.rows.map((r) => r.id)).toEqual(["fklasse", "fairline", "fanlass", "fstatus"]);
    for (const row of group.rows) expect(row.level, row.id).toBe("expert");
    // The reminder for places stays too, although the prototype forgot it.
    expect(
      registryPage("erinnerungen")!
        .sections.flatMap((s) => s.rows)
        .map((r) => r.id)
    ).toContain("r_poi");
  });

  it("gives Unterkünfte its own page only while stays are on, and Mietwagen its loyalty list only with rental", () => {
    expect(registryPage("unterkuenfte")).toMatchObject({ area: "konto", domain: "lodging" });
    const rental = registryPage("treue")!
      .sections.flatMap((s) => s.rows)
      .find((r) => r.id === "tr_rental")!;
    expect(rental.domain).toBe("rental");
    const off = { isAdmin: false, isDomainOn: (d: string) => d !== "lodging" && d !== "rental" };
    const found = findableRows({ ...off, isGateOpen: () => true }).map((r) => r.row.id);
    expect(found).not.toContain("ratingcats");
    expect(found).not.toContain("tr_rental");
    const on = findableRows({ isAdmin: false, isDomainOn: () => true, isGateOpen: () => true }).map(
      (r) => r.row.id
    );
    expect(on).toContain("ratingcats");
    expect(on).toContain("tr_rental");
  });
});

describe("the area mounts what the registry lists", () => {
  it("has a page for every registry page, and none besides", () => {
    expect(AREA_PAGES.map((p) => p.id)).toEqual(SETTINGS_REGISTRY.map((p) => p.id));
  });

  it("leaves no registry row without a mounted control", () => {
    const orphans: string[] = [];
    for (const page of SETTINGS_REGISTRY) {
      const mounts = findAreaPage(page.id)!.sections;
      for (const section of page.sections) {
        for (const row of section.rows) {
          // The catalogue's rows are answered by its one mount (`?match=`, `#<card>`).
          const mount = row.mount
            ? mounts.find((m) => m.id === row.mount)
            : mountFor(page.id, section.id, row.id);
          if (!mount) orphans.push(`${page.id}/${section.id}/${row.id}`);
          // The address a search hit carries reaches the same mount.
          else expect(mountFor(page.id, section.id, row.id)?.id, row.id).toBe(mount.id);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it("names a mount on every row outside the service catalogue", () => {
    for (const page of SETTINGS_REGISTRY.filter((p) => p.id !== "dienstek" && p.id !== "dienste")) {
      for (const row of page.sections.flatMap((s) => s.rows)) {
        expect(row.mount, `${page.id}/${row.id}`).toBeTruthy();
      }
    }
  });

  it("draws no control without a registry row", () => {
    for (const page of AREA_PAGES) {
      const rows = registryPage(page.id)!.sections.flatMap((s) => s.rows);
      for (const mount of page.sections) {
        const owns =
          rows.some((r) => r.mount === mount.id) || page.id === "dienstek" || page.id === "dienste";
        expect(owns, `${page.id}/${mount.id}`).toBe(true);
      }
    }
  });

  it("answers for every registry group of a page with one of its mounts", () => {
    for (const page of SETTINGS_REGISTRY) {
      const mounts = findAreaPage(page.id)!.sections;
      for (const section of page.sections) {
        const answered = mounts.some((m) => m.id === section.id || m.anchors.includes(section.id));
        expect(answered, `${page.id}/${section.id}`).toBe(true);
      }
    }
  });

  it("puts every page in the menu exactly once", () => {
    const listed = AREA_MENU.flatMap((g) => g.pages);
    expect([...listed].sort()).toEqual(AREA_PAGES.map((p) => p.id).sort());
  });

  it("groups the menu as Mein Konto, TravTrack, TravPlan and the server's (admin pages only)", () => {
    expect(AREA_MENU.map((g) => g.id)).toEqual(["konto", "track", "plan", "server"]);
    const server = AREA_MENU.find((g) => g.id === "server")!;
    expect(server.pages.every((id) => findAreaPage(id)!.adminOnly)).toBe(true);
    // The admin's "Bereitstellung" pages close the TravTrack and TravPlan areas.
    const bereit = ["tt-bereit", "pl-bereit"];
    for (const id of ["konto", "track", "plan"]) {
      const group = AREA_MENU.find((g) => g.id === id)!;
      expect(
        group.pages.every((p) => !findAreaPage(p)!.adminOnly || bereit.includes(p)),
        id
      ).toBe(true);
    }
    expect(AREA_MENU.find((g) => g.id === "track")!.pages).toEqual([
      "tt-aufz",
      "tt-erk",
      "tt-daten",
      "tt-bereit",
    ]);
    expect(AREA_MENU.find((g) => g.id === "plan")!.pages).toEqual(["pl-plan", "pl-bereit"]);
  });

  it("waits for the server's answer before the TravTrack and TravPlan pages show", () => {
    // The source choice and the stay search also stay for an account on Dawarich alone.
    const dawarichToo = new Set(["ttRecording", "ttDetect"]);
    for (const id of ["tt-aufz", "tt-erk", "tt-daten"]) {
      for (const mount of findAreaPage(id)!.sections) {
        expect(mount.when, `${id}/${mount.id}`).toBe(
          dawarichToo.has(mount.id) ? "locationSourceHeld" : "travTrackHeld"
        );
      }
    }
    // The server's switches wait for nothing: an admin switches TravTrack on there.
    for (const id of ["tt-bereit", "pl-bereit"]) {
      expect(findAreaPage(id)!.sections.map((m) => m.when)).toEqual([undefined]);
    }
    expect(findAreaPage("pl-plan")!.sections.map((m) => m.when)).toEqual(["travPlanOffered"]);
  });
});

describe("TravTrack and TravPlan pages follow the prototype (settings v3 S4)", () => {
  const where = (id: string) => {
    for (const page of SETTINGS_REGISTRY)
      for (const group of page.sections) {
        const row = group.rows.find((r) => r.id === id);
        if (row) return { page: page.id, group: group.id, row };
      }
    return undefined;
  };

  it("moves the stay switches from Reisen to Erkennung & Vorschläge, each in its prototype group", () => {
    expect(where("avor")).toMatchObject({ page: "tt-erk", group: "tt-erk-aufenthalte" });
    expect(where("immichbeleg")).toMatchObject({ page: "tt-erk", group: "tt-erk-belege" });
    expect(where("kiort")).toMatchObject({ page: "tt-erk", group: "tt-erk-feinabstimmung" });
    expect(where("kiort")!.row.level).toBe("expert");
    expect(registryPage("reisen")!.sections.flatMap((g) => g.rows.map((r) => r.id))).not.toEqual(
      expect.arrayContaining(["avor"])
    );
  });

  it("lists 'Track trennen ab' as a standard row of Feinabstimmung", () => {
    expect(where("trackgap")).toMatchObject({ page: "tt-erk", group: "tt-erk-feinabstimmung" });
    expect(where("trackgap")!.row).toMatchObject({ level: "standard", mount: "ttDetect" });
  });

  it("gives TravTrack and TravPlan a Bereitstellung page each and leaves Funktionen without them", () => {
    expect(where("ttoffer")).toMatchObject({ page: "tt-bereit" });
    expect(where("tpoffer")).toMatchObject({ page: "pl-bereit", group: "pl-bereit-travplan" });
    expect(where("pl_ai")).toMatchObject({ page: "pl-bereit", group: "pl-bereit-grenzen" });
    expect(where("pl_wx")).toMatchObject({ page: "pl-bereit", group: "pl-bereit-grenzen" });
    expect(where("tplimits")).toBeUndefined();
    const funktionen = registryPage("funktionen")!.sections.flatMap((g) => g.rows.map((r) => r.id));
    expect(funktionen).not.toEqual(expect.arrayContaining(["ttoffer"]));
    expect(funktionen).not.toEqual(expect.arrayContaining(["tpoffer"]));
  });

  it("makes 'Unterkunft während der Buchung' and the search tuning expert rows", () => {
    expect(where("unterkunft")!.row.level).toBe("expert");
    // No "Märkte, Parks und Museen" switch: since 2.8 the server runs area recognition always.
    expect(where("gelaende")).toBeUndefined();
    expect(where("scanzeit")!.row.level).toBe("expert");
    expect(where("staedte")!.row.level).toBe("expert");
  });
});

describe("the server area follows the prototype (settings v3 S5)", () => {
  const rowsOf = (page: string, group?: string): string[] =>
    registryPage(page)!
      .sections.filter((g) => !group || g.id === group)
      .flatMap((g) => g.rows.map((r) => r.id));
  const level = (page: string, row: string): string =>
    registryPage(page)!
      .sections.flatMap((g) => g.rows)
      .find((r) => r.id === row)!.level;

  it("has the thirteen pages in the prototype's order", () => {
    expect(AREA_MENU.find((g) => g.id === "server")!.pages).toEqual([
      "allgemein",
      "nutzer",
      "funktionen",
      "email",
      "buchungen",
      "dienste",
      "sicherungen",
      "srvconn",
      "datenschutz",
      "adressen",
      "eigene",
      "wartung",
      "stamm",
    ]);
  });

  it("makes the four expert pages expert as a whole, and the others standard", () => {
    for (const id of ["adressen", "eigene", "wartung", "stamm"]) {
      expect(pageLevel(findAreaPage(id)!), id).toBe("expert");
    }
    for (const id of ["allgemein", "nutzer", "funktionen", "email", "buchungen", "dienste"]) {
      expect(pageLevel(findAreaPage(id)!), id).toBe("standard");
    }
  });

  it("takes the addresses and the passkeys out of Allgemein and gives them a page", () => {
    expect(rowsOf("allgemein")).toEqual([
      "instname",
      "puburl",
      "puburlw",
      "registr",
      "maxnutzer",
      "loginbilder",
    ]);
    expect(rowsOf("adressen")).toEqual(["pairurl", "lanurl", "rpid", "origins"]);
    expect(level("allgemein", "loginbilder")).toBe("expert");
    expect(level("allgemein", "instname")).toBe("standard");
  });

  it("splits the service cards: mail, privacy, connections and own servers are pages, not cards", () => {
    expect(rowsOf("email").slice(0, 6)).toEqual([
      "smtphost",
      "smtpuser",
      "smtppw",
      "smtpfrom",
      "smtptest",
      "mailstat",
    ]);
    expect(rowsOf("datenschutz")).toEqual(["nutzstat", "pushon", "pushrelay", "pushreset"]);
    expect(rowsOf("srvconn")).toEqual(["requests", "fedpeers", "fedorigin", "fedkey", "fedtrips"]);
    expect(rowsOf("eigene")).toEqual([
      "geoeigen",
      "photon",
      "nominatim",
      "osrm",
      "orr",
      "overpass",
      "tplrepo",
      "fxsrc",
    ]);
    const cards = registryPage("dienste")!.sections.map((c) => c.id);
    for (const id of [
      "smtp",
      "push",
      "usageStats",
      "federation",
      "geocoder",
      "selfHostedRouting",
    ]) {
      expect(cards, id).not.toContain(id);
    }
    // The prototype's 21 cards, then the two that are left of the folded ones (expert).
    expect(cards).toHaveLength(23);
    const expertCards = registryPage("dienste")!.sections.filter((c) => c.level === "expert");
    expect(expertCards.map((c) => c.id)).toEqual(["railTimetables", "openData"]);
  });

  it("puts the master internet switch first on Funktionen, in Netz, as a standard row", () => {
    // The five outbound switches follow it as expert rows (owner, 2026-11-12).
    expect(rowsOf("funktionen", "funktionen-netz")).toEqual([
      "internet",
      "fxcdn",
      "transitous",
      "dbrest",
      "oplogos",
      "updcheck",
    ]);
    expect(level("funktionen", "internet")).toBe("standard");
    for (const id of ["fxcdn", "transitous", "dbrest", "oplogos", "updcheck"]) {
      expect(level("funktionen", id)).toBe("expert");
    }
    expect(rowsOf("funktionen")).toEqual([
      "internet",
      "fxcdn",
      "transitous",
      "dbrest",
      "oplogos",
      "updcheck",
      "linkserlaubt",
      "fedon",
      "l_tt",
      "l_pl",
      "beta",
      "importmodus",
    ]);
    for (const id of ["beta", "importmodus"]) {
      expect(level("funktionen", id), id).toBe("expert");
    }
  });

  it("makes Wartung's 24 h log a row of its own, and keeps the old verbose switch out", () => {
    expect(rowsOf("wartung")).toContain("debug24");
    expect(rowsOf("wartung")).not.toContain("debug");
  });

  it("keeps the accounts' own keys switch in Buchungen lesen, an expert row", () => {
    expect(rowsOf("buchungen")).toContain("userkeys");
    expect(level("buchungen", "userkeys")).toBe("expert");
    expect(level("buchungen", "leserfolge")).toBe("expert");
    expect(level("buchungen", "kiaktiv")).toBe("standard");
  });

  it("waits for the federation switch before 'Server-Verbindungen' is reachable", () => {
    const page = findAreaPage("srvconn")!;
    expect(page.sections.map((m) => m.when)).toEqual(["federationOn"]);
    expect(pageReachable(page, {})).toBe(false);
    expect(pageReachable(page, { federationOn: false })).toBe(false);
    expect(pageReachable(page, { federationOn: true })).toBe(true);
    // Every other server page is there regardless.
    for (const id of ["email", "dienste", "datenschutz", "adressen", "eigene"]) {
      expect(pageReachable(findAreaPage(id)!, {}), id).toBe(true);
    }
  });

  it("lays the Sicherungen out as the prototype does: the backup first, the tuning behind it", () => {
    expect(findAreaPage("sicherungen")!.sections.map((m) => [m.id, m.level])).toEqual([
      ["backups", "standard"],
      ["automatic", "expert"],
    ]);
    expect(rowsOf("sicherungen", "sicherungen-sicherung")).toEqual([
      "baknow",
      "bakjetzt",
      "bakliste",
      "bakwdload",
    ]);
    for (const id of ["baktakt", "bakhalten", "bakwddel", "bakzone"]) {
      expect(level("sicherungen", id), id).toBe("expert");
    }
    // Automatic backup has no switch since S6: it is always on.
    expect(rowsOf("sicherungen")).not.toContain("autobak");
  });
});

describe("the account rows that came with the S2 backend (settings v3 S5)", () => {
  const find = (page: string, row: string) =>
    registryPage(page)!
      .sections.flatMap((g) => g.rows.map((r) => ({ group: g.id, ...r })))
      .find((r) => r.id === row);

  it("has 'Für andere Server auffindbar' in Profil › Sichtbarkeit", () => {
    expect(find("profil", "findable")).toMatchObject({
      group: "profil-sichtbarkeit",
      mount: "visibility",
      level: "standard",
    });
  });

  it("has the display currency beside the base currency, which stays an expert row", () => {
    expect(find("anzeige", "anzeigew")).toMatchObject({ level: "standard", mount: "units" });
    expect(find("anzeige", "waehrung")).toMatchObject({ level: "expert" });
  });

  it("has AI suggestions and weather in plans on the TravPlan page", () => {
    expect(find("pl-plan", "planai")).toMatchObject({ level: "standard", mount: "planning" });
    expect(find("pl-plan", "planwx")).toMatchObject({ level: "standard", mount: "planning" });
  });
});

describe("the expert count", () => {
  const everything = { isDomainOn: () => true, isGateOpen: () => true };

  it("counts the rows only the expert level shows", () => {
    const admin = expertRowCount({ ...everything, isAdmin: true });
    const user = expertRowCount({ ...everything, isAdmin: false });
    expect(user).toBeGreaterThan(0);
    // The server's expert pages are an admin's alone.
    expect(admin).toBeGreaterThan(user);
  });

  it("leaves out the rows of a switched-off domain and of a closed beta gate", () => {
    const all = expertRowCount({ ...everything, isAdmin: true });
    expect(
      expertRowCount({ isAdmin: true, isDomainOn: () => false, isGateOpen: () => true })
    ).toBeLessThan(all);
    expect(
      findableRows({ isAdmin: true, isDomainOn: () => true, isGateOpen: () => false }).length
    ).toBeLessThan(findableRows({ ...everything, isAdmin: true }).length);
  });
});

describe("account deletion is immediate (owner, 2026-11-01)", () => {
  it("the search terms of the delete-account row promise no grace period and no cancelling", () => {
    const row = registryPage("profil")!
      .sections.flatMap((s) => s.rows)
      .find((r) => r.id === "deleteacct")!;
    const terms = `${row.terms.de} ${row.terms.en}`.toLowerCase();
    expect(terms).not.toMatch(/frist|grace|abbrechen|cancel/);
    expect(row.terms.de).toContain("sofort");
    expect(row.terms.en).toContain("at once");
  });
});
