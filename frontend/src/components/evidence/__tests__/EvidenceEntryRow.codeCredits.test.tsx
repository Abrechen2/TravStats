import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EvidenceEntry } from "../../../shared/evidence";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import EvidenceEntryRow from "../EvidenceEntryRow";

/**
 * A credit the server sends as a CODE is named in the reader's language
 * (forgejo#259): "belegt: landmark, nature" printed the server's tokens raw in
 * the German UI. A place category is named by the places UI's own labels, a
 * calendar day the way the row's date is.
 */
function renderRow(credits: string[], unit: string): void {
  const entry: EvidenceEntry = {
    domain: "place",
    id: "v1",
    href: "/places/p1",
    title: { text: "Kolosseum" },
    subtitle: null,
    date: null,
    credits,
  };
  render(
    <MemoryRouter>
      <ul>
        <EvidenceEntryRow entry={entry} aggregation="distinct" unit={unit} />
      </ul>
    </MemoryRouter>
  );
}

describe("EvidenceEntryRow — credits that are codes", () => {
  it("names place categories with their German labels", () => {
    renderRow(["landmark", "nature"], "categories");
    expect(screen.getByText("belegt: Wahrzeichen, Natur")).toBeInTheDocument();
  });

  it("writes a credited day as a date, not as an ISO string", () => {
    renderRow(["2024-03-05"], "days");
    expect(screen.queryByText(/2024-03-05/)).not.toBeInTheDocument();
    expect(screen.getByText(/belegt: .*2024/)).toBeInTheDocument();
  });

  it("leaves a key that is no category code as it is", () => {
    renderRow(["MUC"], "categories");
    expect(screen.getByText("belegt: MUC")).toBeInTheDocument();
  });
});
