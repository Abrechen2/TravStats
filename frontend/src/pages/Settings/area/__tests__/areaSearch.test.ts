import { describe, expect, it } from "vitest";
import { mountFor } from "../areaModel";
import { searchArea } from "../areaSearch";
import { SETTINGS_REGISTRY, type RegistryAccess } from "../../registry";

const admin: RegistryAccess = { isAdmin: true, isDomainOn: () => true, isGateOpen: () => true };
const user: RegistryAccess = { ...admin, isAdmin: false };
const find = (query: string, access = admin, lang: "de" | "en" = "de") =>
  searchArea(query, SETTINGS_REGISTRY, access, lang).hits;

describe("the settings search reads the registry", () => {
  it("finds a row by its name and links it as page, ?match=row and #section", () => {
    const hit = find("Vorname")[0];
    expect(hit).toMatchObject({
      pageId: "profil",
      sectionId: "profil-personliche-angaben",
      rowId: "vorname",
    });
    expect(hit.href).toBe("/settings/profil?match=vorname#profil-personliche-angaben");
    expect(hit.expertOnly).toBe(false);
  });

  it("finds in either language, whichever the reader has on", () => {
    expect(find("first name", admin, "de").map((h) => h.rowId)).toContain("vorname");
    expect(find("Vorname", admin, "en").map((h) => h.rowId)).toContain("vorname");
    expect(find("Vorname", admin, "en")[0].label).toBe("First name");
  });

  it("finds an expert row, says so, and asks for it by ?expert=1 — never by changing the level", () => {
    const hit = find("Altes Anmeldeverfahren").find((h) => h.rowId === "oskuser")!;
    expect(hit).toBeDefined();
    expect(hit.expertOnly).toBe(true);
    expect(hit.href).toContain("expert=1");
    expect(hit.href).toContain("service=opensky");
  });

  it("finds a word that only a row's hint or help carries", () => {
    expect(find("Geburtstagsflug").some((h) => h.rowId === "geburtstag")).toBe(true);
  });

  it("finds a service card by its name though it holds no rows of its own", () => {
    const hit = find("AirLabs").find((h) => h.sectionId === "airlabs")!;
    expect(hit.rowId).toBeNull();
    expect(hit.href).toBe("/settings/dienstek?service=airlabs#airlabs");
  });

  it("ranks a name that starts with the query before one that contains it", () => {
    const ranks = find("Sprache").map((h) => h.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("finds nothing under two characters, and nothing for gibberish", () => {
    expect(find("a")).toEqual([]);
    expect(find("qqzzxx")).toEqual([]);
  });

  it("does not offer the server's rows to an account without the permission", () => {
    expect(find("Anfragen pro Tag", admin).length).toBeGreaterThan(0);
    const onlyServer = (access: RegistryAccess) =>
      find("wann zählt ein Land", access).filter((h) => h.pageId === "funktionen");
    expect(onlyServer(admin).length).toBeGreaterThan(0);
    expect(onlyServer(user)).toEqual([]);
    expect(find("Mailserver", user).some((h) => h.pageId === "email")).toBe(false);
    expect(find("Mailserver", admin).some((h) => h.pageId === "email")).toBe(true);
  });

  it("leaves out a row of a closed beta gate and of a switched-off domain", () => {
    const closed: RegistryAccess = { ...admin, isGateOpen: () => false };
    expect(find("TravTrack anbieten").some((h) => h.rowId === "ttoffer")).toBe(true);
    expect(find("TravTrack anbieten", closed).some((h) => h.rowId === "ttoffer")).toBe(false);
    const noFlights: RegistryAccess = { ...admin, isDomainOn: (d) => d !== "flight" };
    expect(find("Heimatflughäfen", noFlights).some((h) => h.pageId === "reisearten")).toBe(false);
  });

  it("marks the mounted section a hit should highlight, through the page's aliases", () => {
    // The passport row moved to the profile block, which draws on Profil & Anmeldung.
    const hit = find("Reisepass").find((h) => h.rowId === "pass")!;
    expect(hit.pageId).toBe("profil");
    expect(hit.highlight).toBe("profile");
    // A service card answers to the one section that draws the catalogue.
    const card = find("Immich").find((h) => h.sectionId === "immich")!;
    expect(card.highlight).toBe("externalServices");
    // A row of the server's TravTrack switch scrolls to its own block.
    const tt = find("TravTrack anbieten").find((h) => h.rowId === "ttoffer")!;
    expect(tt.pageId).toBe("tt-bereit");
    expect(tt.highlight).toBe("ttoffer");
  });
});

describe("a row of the server's side of a service card", () => {
  it("lands on the services page's one section, whichever side of the card the row is", () => {
    const hit = find("Client-ID des Servers").find((h) => h.rowId === "oskidI")!;
    expect(hit).toBeDefined();
    expect(hit.highlight).toBe("externalServices");
  });
});

describe("which mount answers for a service card", () => {
  it("gives a server-only card (airlabs on the server's page) to the services section for an admin", () => {
    expect(mountFor("dienste", "aeroapi", null, true)?.id).toBe("externalServices");
  });

  it("gives an account no mount on the server's page, and its own keys on its own page", () => {
    expect(mountFor("dienste", "aeroapi", null, false)).toBeUndefined();
    expect(mountFor("dienstek", "airlabs", null, false)?.id).toBe("externalServices");
  });

  it("sends a card with a page of its own there: the geocoder's rows are on Eigene Server", () => {
    const hit = find("Photon").find((h) => h.rowId === "photon")!;
    expect(hit.pageId).toBe("eigene");
    expect(hit.highlight).toBe("own");
    // The account's page holds no card the account has nothing to do with.
    expect(mountFor("dienstek", "geocoder", null, true)).toBeUndefined();
  });
});
