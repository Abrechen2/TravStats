import { describe, expect, it } from "vitest";
import { cardStatus } from "../cardStatus";
import { SERVICE_CARDS, SERVICE_GROUPS } from "../serviceCards";
import { UNREACHABLE_NOTE } from "../unreachable";
import { registryPage } from "../../../pages/Settings/registry";
import { accountOverview, admin } from "./servicesFixtures";

const cardOf = (id: string) => SERVICE_CARDS.find((c) => c.id === id)!;
const acct = accountOverview().ownKeys[0];

describe("the 31 cards", () => {
  it("are the catalogue's entries in its seven groups (R7)", () => {
    const sizes = SERVICE_GROUPS.map((g) => SERVICE_CARDS.filter((c) => c.group === g).length);
    expect(sizes).toEqual([7, 7, 3, 5, 3, 3, 3]);
  });

  it("are the registry's service cards, one for one", () => {
    const ids = registryPage("dienstek")!.sections.map((s) => s.id);
    expect(SERVICE_CARDS.map((c) => c.id)).toEqual(ids);
  });

  it("give a connection 'accounts may connect' and a key 'allow own keys', never both (R7)", () => {
    const connections = ["immich", "dawarich", "strava", "webdav"];
    for (const c of SERVICE_CARDS) {
      const conn = (c.use as readonly string[]).includes("allowConn");
      expect(conn).toBe(connections.includes(c.id));
      if (conn) expect(c.use).not.toContain("allowKeys");
    }
  });

  it("have no off switch where the catalogue says always on", () => {
    for (const id of ["geocoder", "fx"]) {
      expect(cardOf(id).use).toEqual(["always"]);
    }
  });

  it("carry a sentence for what happens when an outside service does not answer", () => {
    for (const id of Object.keys(UNREACHABLE_NOTE)) expect(cardOf(id)).toBeDefined();
  });
});

describe("cardStatus", () => {
  it("is 'always' for an always-on service whatever else is true", () => {
    expect(cardStatus({ card: cardOf("fx"), isAdmin: false })).toBe("always");
  });

  it("says 'rejected' only for a credential the last test really refused", () => {
    const rejected = {
      ...acct,
      effectiveSource: "account" as const,
      lastTest: { at: "x", ok: false, reason: "auth" },
    };
    const unreachable = { ...rejected, lastTest: { at: "x", ok: false, reason: "network" } };
    expect(cardStatus({ card: cardOf("airlabs"), isAdmin: false, account: rejected })).toBe(
      "keyRejected"
    );
    expect(cardStatus({ card: cardOf("airlabs"), isAdmin: false, account: unreachable })).toBe(
      "connected"
    );
  });

  it("lets the server's switch win over what an account chose", () => {
    const own = { ...acct, effectiveSource: "off" as const };
    expect(cardStatus({ card: cardOf("airlabs"), isAdmin: false, account: own })).toBe(
      "offByAdmin"
    );
    expect(
      cardStatus({
        card: cardOf("airlabs"),
        isAdmin: true,
        account: acct,
        admin: admin("airlabs", { enabled: false }),
      })
    ).toBe("off");
  });

  it("tells 'switched off for me' from 'switched off by the admin'", () => {
    expect(
      cardStatus({
        card: cardOf("airlabs"),
        isAdmin: false,
        account: { ...acct, accountDisabled: true, effectiveSource: "off" },
      })
    ).toBe("off");
  });

  it("walks cloud AI from not released, to released, to agreed", () => {
    const card = cardOf("openai");
    expect(cardStatus({ card, isAdmin: false })).toBe("notEnabled");
    const consent = {
      id: "openai",
      provider: "openai",
      destination: "api.openai.com",
      consentedAt: null,
    };
    expect(cardStatus({ card, isAdmin: false, consent })).toBe("needsConsent");
    expect(
      cardStatus({ card, isAdmin: false, consent: { ...consent, consentedAt: "2026-11-01" } })
    ).toBe("ready");
  });

  it("calls an unconnected connection 'not connected' and an unkeyed service 'not set up'", () => {
    const none = { ...acct, effectiveSource: "none" as const };
    expect(
      cardStatus({ card: cardOf("immich"), isAdmin: false, account: { ...none, id: "immich" } })
    ).toBe("notConnected");
    expect(cardStatus({ card: cardOf("airlabs"), isAdmin: false, account: none })).toBe("notSetUp");
  });
});
