import { describe, expect, it } from "vitest";

import { routingEffectiveText } from "../RoutingLines";

const t = (key: string, o?: Record<string, unknown>): string =>
  `${key}${o?.provider ? `[${String(o.provider)}]` : ""}`;

describe("routingEffectiveText", () => {
  it("names provider, own key and own quota from the one resolution", () => {
    expect(
      routingEffectiveText(t, {
        mode: "auto",
        selected: null,
        providerId: "openrouteservice",
        keySource: "account",
        hint: null,
      })
    ).toBe(
      "settingsRows:services.routing.via[OpenRouteService] · settingsRows:services.routing.yourKey"
    );
  });

  it("gives a concrete setup hint when nothing answers", () => {
    expect(
      routingEffectiveText(t, {
        mode: "auto",
        selected: null,
        providerId: null,
        keySource: null,
        hint: "noProvider",
      })
    ).toBe("settingsRows:services.routing.noProvider");
  });
});
