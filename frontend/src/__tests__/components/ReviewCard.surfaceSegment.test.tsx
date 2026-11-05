import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ReviewCard from "../../components/inbox/workspace/ReviewCard";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * A stored flight that is a train or bus ride (owner ruling 2026-11-05) as a
 * German reader sees it: a question naming the flight and what it really is,
 * and the server's `convert` answer as a button — never converted unasked.
 */

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const resolve = vi.fn(async () => ({ success: true }));
vi.mock("../../lib/api/dataQualityFlags", () => ({
  dataQualityFlagsApi: {
    resolve: (...args: unknown[]) => resolve(...(args as [])),
    dismiss: vi.fn(async () => ({ success: true })),
    run: vi.fn(),
  },
}));

const flag = (actions: "convert"[] | undefined): DataQualityFlag => ({
  id: "flag-9",
  status: "open",
  createdAt: "2026-11-05T08:00:00.000Z",
  resolvedAt: null,
  undoUntil: null,
  revision: 2,
  ...(actions ? { actions } : {}),
  entityType: "flight",
  entityId: "fl1",
  kind: "surface_segment",
  subject: {
    entityType: "flight",
    entityId: "fl1",
    label: "LH8878 QKL → FRA",
    parentId: null,
    parentType: null,
    tripId: null,
  },
  details: {
    flightId: "fl1",
    mode: "rail",
    signals: ["equipment"],
    flightNumber: "LH8878",
    departureCode: "QKL",
    arrivalCode: "FRA",
  },
});

function renderCard(f: DataQualityFlag) {
  const act = vi.fn(async (run: () => Promise<unknown>) => {
    await run();
    return true;
  });
  render(
    <MemoryRouter>
      <ReviewCard flag={f} busy={false} act={act as never} />
    </MemoryRouter>
  );
}

describe("ReviewCard — flight that is a train or bus ride", () => {
  it("names the flight and says what it is instead of the unknown-question fallback", () => {
    renderCard(flag(["convert"]));
    expect(screen.queryByText(/kennt diese Version/)).toBeNull();
    expect(screen.getByText(/LH8878 \(QKL → FRA\).*eine Zugfahrt/)).toBeInTheDocument();
  });

  it("converts only on the button, with the revision it showed", () => {
    renderCard(flag(["convert"]));
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "In Zug- oder Busfahrt umwandeln" }));
    expect(resolve).toHaveBeenCalledWith("flag-9", { action: "convert", revision: 2 });
  });

  it("shows no convert button when the server does not offer it", () => {
    renderCard(flag(undefined));
    expect(screen.queryByRole("button", { name: "In Zug- oder Busfahrt umwandeln" })).toBeNull();
  });
});
