/**
 * A special flight's tags are chips with the user's own tags offered, while
 * the modal around them keeps its comma-separated state: the field adapts at
 * the edge, the save path is unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../lib/api", () => ({
  companionsApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/hooks/useTagSuggestions", () => ({
  useTagSuggestions: () => [{ name: "bucket-list", usageCount: 1 }],
}));

import { CommonTimeAndMetaFields } from "../SpecialFlightModalFields";

function Harness({ onTags }: { onTags: (csv: string) => void }): JSX.Element {
  const [tagsCsv, setTagsCsv] = useState("anniversary");
  return (
    <CommonTimeAndMetaFields
      departureTime=""
      onDepartureTimeChange={vi.fn()}
      arrivalTime=""
      onArrivalTimeChange={vi.fn()}
      notes=""
      onNotesChange={vi.fn()}
      tagsCsv={tagsCsv}
      onTagsCsvChange={(csv) => {
        onTags(csv);
        setTagsCsv(csv);
      }}
      companions={[]}
      onCompanionsChange={vi.fn()}
    />
  );
}

describe("CommonTimeAndMetaFields — tags", () => {
  it("shows the stored tags as chips and writes picks back as a comma list", async () => {
    const onTags = vi.fn();
    render(<Harness onTags={onTags} />);

    expect(screen.getByTestId("tag-remove-anniversary")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("combobox", { name: "specialFlights:field.tags" }), "bu");
    await userEvent.click(screen.getByRole("option", { name: /bucket-list/ }));

    expect(onTags).toHaveBeenLastCalledWith("anniversary, bucket-list");
  });
});
