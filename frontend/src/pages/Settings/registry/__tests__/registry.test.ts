import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AREA_MENU, AREA_PAGES, findAreaPage, mountFor } from "../../area/areaModel";
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

  it("counts 27 pages, 98 groups and cards (31 of them service cards) and 272 rows", () => {
    const sections = SETTINGS_REGISTRY.flatMap((p) => p.sections);
    expect(SETTINGS_REGISTRY).toHaveLength(27);
    expect(sections).toHaveLength(98);
    expect(sections.filter((s) => s.serviceCategory)).toHaveLength(31);
    expect(sections.flatMap((s) => s.rows)).toHaveLength(272);
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
      "buchungen",
      "sicherungen",
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
    // An account's page holds server rows too ("Alle Konten"), admin-only in it.
    const smtp = registryPage("dienstek")!.sections.find((s) => s.id === "smtp")!;
    expect(smtp.audience).toBe("admin");
    const opensky = registryPage("dienstek")!.sections.find((s) => s.id === "opensky")!;
    expect(opensky.rows.some((r) => r.scope === "instance" && r.audience === "admin")).toBe(true);
    expect(opensky.rows.some((r) => r.scope === "account" && r.audience === "all")).toBe(true);
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
    for (const page of SETTINGS_REGISTRY.filter((p) => p.id !== "dienstek")) {
      for (const row of page.sections.flatMap((s) => s.rows)) {
        expect(row.mount, `${page.id}/${row.id}`).toBeTruthy();
      }
    }
  });

  it("draws no control without a registry row", () => {
    for (const page of AREA_PAGES) {
      const rows = registryPage(page.id)!.sections.flatMap((s) => s.rows);
      for (const mount of page.sections) {
        const owns = rows.some((r) => r.mount === mount.id) || page.id === "dienstek";
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
