import { describe, expect, it } from "vitest";
import { germanT } from "../../../../__tests__/helpers/germanT";
import { buildInboxItems } from "../model";
import { run } from "./journeyRun";

describe("inbox item of a journey question", () => {
  it("is about its local day and names its runs and distance", () => {
    const [item] = buildInboxItems(
      [
        {
          source: "location",
          data: {
            id: "s1",
            kind: "journey",
            provider: { kind: "travtrack", rev: 1 },
            window: { fromMs: run.fromMs, untilMs: run.untilMs + 1 },
            algorithm: { name: "journey", version: 1 },
            explanation: { code: "journey.unlogged", params: { runs: 2, km: 180 } },
            status: "pending",
            coverage: "complete",
            journey: {
              day: "2026-10-20",
              zone: "Europe/Berlin",
              runs: [run, { ...run, index: 1 }],
            },
          },
        },
      ],
      [],
      germanT,
      "de"
    );
    expect(item.key).toBe("location:s1");
    expect(item.day).toBe("2026-10-20");
    expect(item.title).toBe("Fahrt aus deinem Standortverlauf");
    expect(item.subject).toBe("2 Fahrten · 180 km");
    expect(item.groupKey).toBe("unassigned");
  });
});
