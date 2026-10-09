import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseDayCard } from "../CruiseDayCard";
import type { EffectiveTimelineEntry } from "../cruisePorts";
import type { CruiseStop, Port } from "../../../types";
import type { TravelDocument } from "../../../lib/api/documents";

/** forgejo#223: one day on one card; a missing time stays open, never invented. */

const oslo = { id: 7, name: "Oslo", country: "Norway", timezone: "Europe/Oslo" } as Port;

const day = (extra: Partial<CruiseStop> = {}): EffectiveTimelineEntry => {
  const stop = {
    id: "s3",
    cruiseId: "c",
    portId: 7,
    port: oslo,
    dayNumber: 3,
    date: "2026-10-07T00:00:00.000Z",
    isAtSea: false,
    arrivalTime: null,
    departureTime: "2026-10-07T18:00:00.000Z",
    excursionNote: "Holmenkollen",
    unresolvedPortName: null,
    ...extra,
  } as CruiseStop;
  return {
    key: "s3",
    stop,
    port: oslo,
    isAtSea: false,
    unresolvedPortName: null,
    date: "2026-10-07",
    excursionNote: stop.excursionNote,
  };
};

const ready = (documents: Partial<TravelDocument>[]) => ({
  status: "ready" as const,
  documents: documents as TravelDocument[],
});

describe("CruiseDayCard", () => {
  it("bundles port, time in port, excursion and the day's documents", () => {
    render(
      <CruiseDayCard
        entry={day({ allAboardTime: "17:30", arrivalTime: "2026-10-07T08:00:00.000Z" })}
        isToday
        documents={ready([
          {
            id: "d1",
            displayName: "Ausflug Holmenkollen.pdf",
            issuedOn: "2026-10-07",
            url: "/api/v1/documents/d1/file",
          },
          { id: "d2", displayName: "Buchung.pdf", issuedOn: "2026-05-01", url: "/x" },
        ])}
        onRetryDocuments={vi.fn()}
      />
    );
    const card = screen.getByRole("region", { name: /detail\.day 3/ });
    expect(card.textContent).toContain("dayCard.today");
    expect(card.textContent).toContain("Oslo, Norway");
    expect(card.textContent).toContain("Holmenkollen");
    expect(screen.getByRole("link", { name: "Ausflug Holmenkollen.pdf" })).toHaveAttribute(
      "href",
      "/api/v1/documents/d1/file"
    );
    expect(screen.queryByRole("link", { name: "Buchung.pdf" })).toBeNull();
    expect(card.textContent).toContain("dayCard.localTime");
  });

  it("leaves the all-aboard time open rather than deriving it from the departure", () => {
    render(
      <CruiseDayCard
        entry={day()}
        isToday={false}
        documents={ready([])}
        onRetryDocuments={vi.fn()}
      />
    );
    const card = screen.getByRole("region");
    expect(card.textContent).toContain("dayCard.allAboardOpen");
    expect(card.textContent).not.toContain("dayCard.today");
    // The arrival is missing too: "offen", not a guess.
    expect(card.textContent).toContain("dayCard.inPortTimes");
  });

  it("says when the documents could not be listed, and retries", async () => {
    const retry = vi.fn();
    render(
      <CruiseDayCard
        entry={day()}
        isToday={false}
        documents={{ status: "failed" }}
        onRetryDocuments={retry}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("dayCard.documentsFailed");
    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
