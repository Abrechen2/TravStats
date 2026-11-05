import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AREA_MENU, AREA_PAGES, findAreaPage } from "../../area/areaModel";
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

/** The designer's data, read from the repository: the registry must not drift from it. */
const design = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../ClaudeDesign/handoff/2026-11-01-einstellungen-neu/antwort-runde-2/settings-data.json"
    ),
    "utf8"
  )
) as { pages: DesignPage[] };

describe("the settings registry follows the designer's data", () => {
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

  it("counts 18 pages, 88 sections (31 of them service cards) and 252 rows", () => {
    const sections = SETTINGS_REGISTRY.flatMap((p) => p.sections);
    expect(SETTINGS_REGISTRY).toHaveLength(18);
    expect(sections).toHaveLength(88);
    expect(sections.filter((s) => s.serviceCategory)).toHaveLength(31);
    expect(sections.flatMap((s) => s.rows)).toHaveLength(252);
  });

  it("lists the rows added after the first generation, so search can find them (forgejo#407)", () => {
    const ids = new Set(
      SETTINGS_REGISTRY.flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => r.id)))
    );
    for (const id of ["r_rental", "r_roadtrip", "r_poi", "enrich"])
      expect(ids.has(id), id).toBe(true);
    // Every reminder area the app offers has its row.
    const reminders = SETTINGS_REGISTRY.flatMap((p) => p.sections.flatMap((s) => s.rows)).filter(
      (r) => r.kind === "remind"
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
    for (const id of ["server", "users", "backups", "maintenance", "masterdata"]) {
      const page = registryPage(id)!;
      expect(page.audience, id).toBe("admin");
      for (const row of page.sections.flatMap((s) => s.rows)) {
        expect(row.scope, `${id}/${row.id}`).toBe("instance");
        expect(row.audience, `${id}/${row.id}`).toBe("admin");
      }
    }
    // An account's page holds server rows too ("Alle Konten"), admin-only in it.
    const smtp = registryPage("services")!.sections.find((s) => s.id === "smtp")!;
    expect(smtp.audience).toBe("admin");
    const opensky = registryPage("services")!.sections.find((s) => s.id === "opensky")!;
    expect(opensky.rows.some((r) => r.scope === "instance" && r.audience === "admin")).toBe(true);
    expect(opensky.rows.some((r) => r.scope === "account" && r.audience === "all")).toBe(true);
  });

  it("ties rows to real domains and real beta keys, with the design's tour = roadtrip", () => {
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
    const tour = registryPage("domains")!
      .sections.flatMap((s) => s.rows)
      .find((r) => r.id === "d_tour")!;
    expect(tour.domain).toBe("roadtrip");
  });
});

describe("the area mounts what the registry lists", () => {
  /**
   * Registry sections whose block does not exist yet: they are searchable and
   * their address works, but nothing draws them until the package that builds
   * them (7: server access). A stale entry
   * fails, so the list can only shrink.
   */
  const NOT_MOUNTED_YET: string[] = [];

  it("has a page for every registry page, and none besides", () => {
    expect(AREA_PAGES.map((p) => p.id)).toEqual(SETTINGS_REGISTRY.map((p) => p.id));
  });

  it("answers for every registry section with a mount or an alias, bar the listed ones", () => {
    const unmounted: string[] = [];
    for (const page of SETTINGS_REGISTRY) {
      const mounts = findAreaPage(page.id)!.sections;
      for (const section of page.sections) {
        if (!mounts.some((m) => m.id === section.id || m.anchors.includes(section.id))) {
          unmounted.push(`${page.id}/${section.id}`);
        }
      }
    }
    expect(unmounted).toEqual(NOT_MOUNTED_YET);
  });

  it("lets no alias point at a section the page does not have", () => {
    for (const page of AREA_PAGES) {
      const ids = new Set(registryPage(page.id)!.sections.map((s) => s.id));
      for (const mount of page.sections) {
        for (const alias of mount.anchors) expect(ids.has(alias), `${page.id}/${alias}`).toBe(true);
      }
    }
  });

  it("puts every page in the menu exactly once", () => {
    const listed = AREA_MENU.flatMap((g) => g.pages);
    expect([...listed].sort()).toEqual(AREA_PAGES.map((p) => p.id).sort());
  });

  it("groups the menu as Dein Konto, Server (admin pages only) and About", () => {
    const server = AREA_MENU.find((g) => g.id === "server")!;
    expect(server.pages.every((id) => findAreaPage(id)!.adminOnly)).toBe(true);
    const account = AREA_MENU.find((g) => g.id === "account")!;
    expect(account.pages.every((id) => !findAreaPage(id)!.adminOnly)).toBe(true);
    expect(AREA_MENU[AREA_MENU.length - 1]).toMatchObject({ id: "about", pages: ["about"] });
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
    const row = registryPage("account")!
      .sections.flatMap((s) => s.rows)
      .find((r) => r.id === "deleteacct")!;
    const terms = `${row.terms.de} ${row.terms.en}`.toLowerCase();
    expect(terms).not.toMatch(/frist|grace|abbrechen|cancel/);
    expect(row.terms.de).toContain("sofort");
    expect(row.terms.en).toContain("at once");
  });
});
