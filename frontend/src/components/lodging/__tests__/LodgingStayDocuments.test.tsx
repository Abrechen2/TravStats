/**
 * forgejo#405: a house's detail page showed no documents at all — they
 * lived only inside the stay editor.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { LodgingStay } from "../../../types/lodging";

const mounted = vi.hoisted(() => [] as { type: string; id: string }[]);
vi.mock("../../documents/DocumentsSection", () => ({
  default: ({ entry }: { entry: { type: string; id: string } }) => {
    mounted.push(entry);
    return <div data-testid={`documents-${entry.id}`} />;
  },
}));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import { LodgingStayDocuments } from "../LodgingStayDocuments";

const stay = (id: string, checkIn: string, checkOut: string): LodgingStay =>
  ({
    id,
    lodgingId: "l1",
    checkIn,
    checkOut,
    datePrecision: "DAY",
    checkInTime: null,
    checkOutTime: null,
    nights: null,
  }) as unknown as LodgingStay;

describe("LodgingStayDocuments", () => {
  it("opens the only stay's documents at once, filed against the stay", () => {
    mounted.length = 0;
    render(
      <LodgingStayDocuments stays={[stay("s1", "2024-05-12T00:00:00Z", "2024-05-14T00:00:00Z")]} />
    );
    expect(mounted).toEqual([{ type: "lodgingStay", id: "s1" }]);
  });

  it("fetches a stay's documents only when its row is opened", async () => {
    mounted.length = 0;
    render(
      <LodgingStayDocuments
        stays={[
          stay("s1", "2024-05-12T00:00:00Z", "2024-05-14T00:00:00Z"),
          stay("s2", "2025-05-12T00:00:00Z", "2025-05-14T00:00:00Z"),
        ]}
      />
    );
    expect(mounted).toEqual([]);
    await userEvent.click(screen.getAllByRole("button")[1]);
    expect(mounted).toEqual([{ type: "lodgingStay", id: "s2" }]);
  });

  it("renders nothing for a house without stays", () => {
    const { container } = render(<LodgingStayDocuments stays={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
