import { describe, expect, it } from "vitest";
import { searchArea } from "../areaSearch";
import { SETTINGS_REGISTRY, type RegistryAccess } from "../../registry";

const admin: RegistryAccess = { isAdmin: true, isDomainOn: () => true, isGateOpen: () => true };
const user: RegistryAccess = { ...admin, isAdmin: false };
const find = (query: string, access = admin, lang: "de" | "en" = "de") =>
  searchArea(query, SETTINGS_REGISTRY, access, lang).hits;

describe("the settings search reads the registry", () => {
  it("finds a row by its name and links it as page, ?match=row and #section", () => {
    const hit = find("Vorname")[0];
    expect(hit).toMatchObject({ pageId: "account", sectionId: "profile", rowId: "vorname" });
    expect(hit.href).toBe("/settings/account?match=vorname#profile");
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
    expect(hit.href).toBe("/settings/services?service=airlabs#airlabs");
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
      find("Ein Land zählt ab", access).filter((h) => h.pageId === "server");
    expect(onlyServer(admin).length).toBeGreaterThan(0);
    expect(onlyServer(user)).toEqual([]);
    expect(find("SMTP", user).some((h) => h.sectionId === "smtp")).toBe(false);
    expect(find("SMTP", admin).some((h) => h.sectionId === "smtp")).toBe(true);
  });

  it("leaves out a row of a closed beta gate and of a switched-off domain", () => {
    const closed: RegistryAccess = { ...admin, isGateOpen: () => false };
    expect(find("TravTrack anbieten").some((h) => h.rowId === "ttoffer")).toBe(true);
    expect(find("TravTrack anbieten", closed).some((h) => h.rowId === "ttoffer")).toBe(false);
    const noFlights: RegistryAccess = { ...admin, isDomainOn: (d) => d !== "flight" };
    expect(find("Heimatflughäfen", noFlights).some((h) => h.pageId === "flight")).toBe(false);
  });

  it("marks the mounted section a hit should highlight, through the page's aliases", () => {
    // Registry section `home` has no block of its own: Profil draws it.
    const hit = find("Reisepass").find((h) => h.sectionId === "home");
    if (hit) expect(hit.highlight).toBe("profile");
    // A service card answers to the one section that draws the catalogue.
    const card = find("Immich").find((h) => h.sectionId === "immich")!;
    expect(card.highlight).toBe("externalServices");
    // A row of the server's TravTrack switch scrolls to its own block.
    const tt = find("TravTrack anbieten").find((h) => h.rowId === "ttoffer")!;
    expect(tt.highlight).toBe("features");
  });
});

describe("a row of the server's side of a service card", () => {
  it("highlights and reveals the server's section, not the account's", () => {
    const hit = find("Client-ID des Servers").find((h) => h.rowId === "oskidI")!;
    expect(hit).toBeDefined();
    expect(hit.highlight).toBe("instanceServices");
  });
});
