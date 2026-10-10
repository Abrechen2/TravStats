import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { DomainRecord } from "../../../../types/domainRecords";

const records: DomainRecord[] = [
  {
    domain: "lodging",
    id: "longest-stay",
    value: 7,
    unit: "nights",
    entryId: "s1",
    href: "/lodging/l1",
    label: "Hotel Alpenblick",
  },
  {
    domain: "rail",
    id: "longest-rail-ride",
    value: 1100,
    unit: "km",
    entryId: "r1",
    href: "/rail/r1",
    label: "Wien Hbf → Hamburg Hbf",
    distanceSource: "great_circle",
  },
];
const { getDomainRecords } = vi.hoisted(() => ({ getDomainRecords: vi.fn() }));
vi.mock("../../../../lib/api/stats", () => ({ statsApi: { getDomainRecords } }));

import DomainRecordsSection from "../DomainRecordsSection";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";
import { evidenceOpenedBy } from "../../__tests__/evidenceKeysOpened";
import { expectNoNestedTriggers } from "../../__tests__/noNestedTriggers";

/**
 * forgejo#265 — records beyond flights: one card per record the server
 * sends, each linked to its entry, a straight-line distance named as such,
 * and nothing at all when there is no record.
 */
describe("DomainRecordsSection", () => {
  it("links each record to its entry and names a straight-line distance", async () => {
    getDomainRecords.mockResolvedValueOnce(records);
    render(
      <MemoryRouter>
        <DomainRecordsSection />
      </MemoryRouter>
    );
    const links = await screen.findAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/lodging/l1", "/rail/r1"]);
    expect(screen.getByText(/stats:domainRecords.straightLine/)).toBeInTheDocument();
    expect(screen.getByTestId("domain-records-help")).toBeInTheDocument();
  });

  it("draws nothing without a record, rather than a card of zeros", async () => {
    getDomainRecords.mockResolvedValueOnce([]);
    let container: HTMLElement | undefined;
    // Inside act: the empty answer settles a state update and draws nothing.
    await act(async () => {
      container = render(
        <MemoryRouter>
          <DomainRecordsSection />
        </MemoryRouter>
      ).container;
    });
    expect(getDomainRecords).toHaveBeenCalled();
    expect(container?.textContent).toBe("");
  });

  it("opens each record's witness, lifetime-scoped, without nesting the entry link", async () => {
    getDomainRecords.mockResolvedValueOnce(records);
    const { opened, container } = await evidenceOpenedBy(<DomainRecordsSection />, () =>
      screen.findAllByRole("link")
    );
    expect(opened.map((o) => o.key)).toEqual(["recordLongestStay", "recordLongestRailRide"]);
    for (const o of opened) {
      expect(o.scope).toEqual({ period: "allTime" });
      expect([o.key, EVIDENCE_MEASURES[o.key]?.servedIn]).toEqual([o.key, 1]);
    }
    expectNoNestedTriggers(container);
  });
});
