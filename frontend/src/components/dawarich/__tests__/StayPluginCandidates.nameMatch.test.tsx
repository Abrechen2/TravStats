import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));

import StayPluginCandidates from "../StayPluginCandidates";

/** A plugin's name match (owner 2026-11-24) reads "Name passt (MSA), 780 m", not a bare distance. */
afterEach(cleanup);

const base = {
  pluginId: "p1",
  pluginName: "Archiv",
  name: "MSA Zentralküche Sonthofen",
  confidence: 0.52,
  distanceM: 782,
};

describe("StayPluginCandidates", () => {
  it("names a name match with its word and distance", () => {
    render(
      <StayPluginCandidates
        stayId="s1"
        plugins={[{ ...base, reason: "name", matchedToken: "MSA" }]}
        pending={false}
        picked={null}
        onPick={undefined}
      />
    );
    expect(
      screen.getByText(/inbox\.plugins\.nameMatch\{"token":"MSA","meters":782\}/)
    ).toBeTruthy();
    expect(screen.queryByText(/inbox\.plugins\.distance/)).toBeNull();
  });

  it("keeps the plain distance for a distance match", () => {
    render(
      <StayPluginCandidates
        stayId="s1"
        plugins={[base]}
        pending={false}
        picked={null}
        onPick={undefined}
      />
    );
    expect(screen.getByText(/inbox\.plugins\.distance\{"meters":782\}/)).toBeTruthy();
  });
});
