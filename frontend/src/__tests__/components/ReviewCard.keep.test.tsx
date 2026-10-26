import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ReviewCard from "../../components/inbox/workspace/ReviewCard";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * "Das stimmt so" on a duplicate is the server's `keep` (spec 2026-10-25 C3):
 * it answers every flag over the same copies, where a plain dismiss would
 * leave the sibling question of a three-copy group open.
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

const duplicate = (actions?: ("keep" | "merge")[]): DataQualityFlag => ({
  id: "flag-1",
  status: "open",
  createdAt: "2026-10-10T08:00:00.000Z",
  resolvedAt: null,
  revision: 2,
  ...(actions ? { actions } : {}),
  entityType: "flight",
  entityId: "mail",
  kind: "duplicate_candidate",
  subject: {
    entityType: "flight",
    entityId: "mail",
    label: "LH400 FRA → JFK",
    parentId: null,
    parentType: null,
    tripId: null,
  },
  details: {
    matchedOn: ["departureDay", "flightNumber", "route"],
    dataSource: "email_import",
    copies: [
      {
        entityType: "flight",
        entityId: "typed",
        label: "LH400 FRA → JFK",
        parentId: null,
        dataSource: "manual",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ],
  },
});

function renderCard(flag: DataQualityFlag) {
  const act = vi.fn(async (run: () => Promise<unknown>) => {
    await run();
    return true;
  });
  render(
    <MemoryRouter>
      <ReviewCard flag={flag} busy={false} act={act as never} />
    </MemoryRouter>
  );
}

describe("ReviewCard — keep for a duplicate", () => {
  it("answers 'Das stimmt so' with keep where the server offers it", () => {
    renderCard(duplicate(["keep", "merge"]));
    fireEvent.click(screen.getByRole("button", { name: "Das stimmt so" }));
    expect(resolve).toHaveBeenCalledWith("flag-1", { action: "keep", revision: 2 });
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("falls back to dismiss against a server that offers no actions", () => {
    renderCard(duplicate());
    fireEvent.click(screen.getByRole("button", { name: "Das stimmt so" }));
    expect(dismiss).toHaveBeenCalledWith("flag-1", 2);
  });
});
