import { describe, expect, it } from "vitest";

import de from "../resources/de/sharing.json";
import en from "../resources/en/sharing.json";

/**
 * Three features share one word family (spec 2026-10-16, D11): "teilen" is a
 * copy in a companion's account, "Link" a public link, and "Freigabe" /
 * "Reisegruppe" belong to Vergleichen. Trip sharing's copy said "Freigabe" and
 * "Gruppe verlassen" — a reader could not tell the features apart.
 */
const strings = (node: unknown, path = ""): [string, string][] =>
  typeof node === "string"
    ? [[path, node]]
    : Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
        strings(v, path ? `${path}.${k}` : k)
      );

const outsideLinks = (file: unknown) =>
  strings(file).filter(([path]) => !path.startsWith("links."));

const DE_FORBIDDEN = /freigab|freigeb|gruppe/i;
const EN_FORBIDDEN = /\bgroup\b/i;

describe("trip sharing terminology", () => {
  it("never says Freigabe or Gruppe for a shared trip (DE)", () => {
    const hits = outsideLinks(de).filter(([, s]) => DE_FORBIDDEN.test(s));
    expect(hits).toEqual([]);
  });

  it("never says group for a shared trip (EN)", () => {
    const hits = outsideLinks(en).filter(([, s]) => EN_FORBIDDEN.test(s));
    expect(hits).toEqual([]);
  });

  it("catches a forbidden term injected into the copy (positive control)", () => {
    const polluted = { ...de, injected: { probe: "Die Freigabe der Reisegruppe" } };
    const hits = outsideLinks(polluted).filter(([, s]) => DE_FORBIDDEN.test(s));
    expect(hits.map(([p]) => p)).toEqual(["injected.probe"]);

    const pollutedEn = { ...en, injected: { probe: "Leave the group" } };
    const hitsEn = outsideLinks(pollutedEn).filter(([, s]) => EN_FORBIDDEN.test(s));
    expect(hitsEn.map(([p]) => p)).toEqual(["injected.probe"]);
  });
});
