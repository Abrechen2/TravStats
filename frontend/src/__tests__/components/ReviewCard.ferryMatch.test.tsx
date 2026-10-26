import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ReviewCard from "../../components/inbox/workspace/ReviewCard";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * The ferry match (spec 2026-10-25 C3) as a German reader sees it: a question
 * naming the crossing and the trip, links to both, and the server's `link`
 * answer as a button — never the "unknown question" fallback.
 */

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const resolve = vi.fn(async () => ({ success: true }));
const dismiss = vi.fn(async () => ({ success: true }));
vi.mock("../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: {
    resolve: (...args: unknown[]) => resolve(...(args as [])),
    dismiss: (...args: unknown[]) => dismiss(...(args as [])),
    run: vi.fn(),
  },
}));

const flag = (actions: ("link" | "keep" | "merge")[] | undefined): DataQualityFlag => ({
  id: "flag-1",
  status: "open",
  createdAt: "2026-10-10T08:00:00.000Z",
  resolvedAt: null,
  undoUntil: null,
  ...(actions ? { actions } : {}),
  entityType: "ferry_journey",
  entityId: "f1",
  kind: "ferry_match",
  subject: {
    entityType: "ferry_journey",
    entityId: "f1",
    label: "Piraeus → Naxos",
    parentId: null,
    parentType: null,
    tripId: null,
  },
  details: {
    ferryId: "f1",
    candidateTripId: "t1",
    candidateTripName: "Kykladen",
    departurePort: "Piraeus",
    arrivalPort: "Naxos",
    departureTime: {
      utc: "2026-07-05T07:00:00.000Z",
      zone: "Europe/Athens",
      offset: "+03:00",
      local: "2026-07-05T10:00:00",
      precision: "minute",
      zoneSource: "stored",
    },
    reason: "insideTripWindow",
  },
});

function renderCard(
  f: DataQualityFlag,
  act = vi.fn(async (run: () => Promise<unknown>) => {
    await run();
    return true;
  })
) {
  render(
    <MemoryRouter>
      <ReviewCard flag={f} busy={false} act={act as never} />
    </MemoryRouter>
  );
  return act;
}

describe("ReviewCard — ferry match", () => {
  it("asks whether the crossing belongs to the trip and links ride and trip", () => {
    renderCard(flag(["link"]));
    expect(screen.queryByText(/kennt diese Version/)).toBeNull();
    // The port's own clock (10:00 in Athens), not the reader's.
    expect(screen.getByText(/Piraeus → Naxos, .*10:00.*„Kykladen“/)).toBeInTheDocument();
    expect(screen.getByText("Fährfahrt")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Piraeus → Naxos" })).toHaveAttribute(
      "href",
      "/ferry/f1"
    );
    expect(screen.getByRole("link", { name: "Kykladen" })).toHaveAttribute("href", "/trips/t1");
  });

  it("offers 'Zur Reise hinzufügen' and answers with the link action", () => {
    renderCard(flag(["link"]));
    fireEvent.click(screen.getByRole("button", { name: "Zur Reise hinzufügen" }));
    expect(resolve).toHaveBeenCalledWith("flag-1", { action: "link" });
  });

  it("shows no link button when the server does not offer it", () => {
    renderCard(flag(undefined));
    expect(screen.queryByRole("button", { name: "Zur Reise hinzufügen" })).toBeNull();
  });

  it("sends the revision it showed with every answer", () => {
    renderCard({ ...flag(["link"]), revision: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Das stimmt so" }));
    expect(dismiss).toHaveBeenCalledWith("flag-1", 3);
    fireEvent.click(screen.getByRole("button", { name: "Ich habe es korrigiert" }));
    expect(resolve).toHaveBeenCalledWith("flag-1", { revision: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Zur Reise hinzufügen" }));
    expect(resolve).toHaveBeenCalledWith("flag-1", { action: "link", revision: 3 });
  });
});
