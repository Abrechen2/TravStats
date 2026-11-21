import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TimelineWarnings, editPathOf } from "../TimelineWarnings";
import type { TimelineEvent } from "../../../lib/tripTimelineEvents";

const ev = {
  id: "rental-return-r1",
  kind: "rental-return",
  rental: { id: "r1" },
} as unknown as TimelineEvent;

describe("TimelineWarnings", () => {
  it("shows the reason and a link to the rental to correct", () => {
    render(
      <MemoryRouter>
        <TimelineWarnings
          ev={ev}
          findings={[
            { code: "rentalReturnAfterDeparture", eventId: ev.id, otherEventId: "flight-f1" },
          ]}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("timeline-warnings")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/rentals/r1");
  });

  it("renders nothing for an entry without findings", () => {
    const { container } = render(
      <MemoryRouter>
        <TimelineWarnings ev={ev} findings={undefined} />
      </MemoryRouter>
    );
    expect(container.innerHTML).toBe("");
  });

  it("has no edit page for a journal entry", () => {
    expect(editPathOf({ id: "j", kind: "journal" } as unknown as TimelineEvent)).toBeNull();
  });
});
