/**
 * Numbers are a claim. The strip must not make one while the list has nothing
 * trustworthy behind it.
 *
 * Found in UAT with the API unreachable: the cruise list showed
 * "0 Kreuzfahrten · 0 Hafenanläufe · 0 Seetage · 0 Reedereien" directly above
 * "Die Kreuzfahrten konnten nicht geladen werden" — four zeros reading as facts
 * about an empty logbook, on top of a sentence saying we do not know.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ListSummaryStrip from "../ListSummaryStrip";

const figures = [
  { key: "cruises", value: "0", label: "Kreuzfahrten" },
  { key: "seaDays", value: "0", label: "Seetage" },
];

describe("ListSummaryStrip", () => {
  it("shows the figures for the rows on screen", () => {
    render(
      <ListSummaryStrip
        figures={[{ key: "cruises", value: "22", label: "Kreuzfahrten" }]}
        filtered={false}
        filteredLabel="gefiltert"
      />
    );
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.queryByTestId("list-summary-filtered")).not.toBeInTheDocument();
  });

  it("marks itself as filtered, because then it counts something narrower", () => {
    render(<ListSummaryStrip figures={figures} filtered filteredLabel="gefiltert" />);
    expect(screen.getByTestId("list-summary-filtered").textContent).toBe("gefiltert");
  });

  it("renders NOTHING while the list is unknown — no zeros over an error", () => {
    const { container } = render(
      <ListSummaryStrip figures={figures} filtered={false} filteredLabel="gefiltert" unknown />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when a domain offers no figures", () => {
    const { container } = render(
      <ListSummaryStrip figures={[]} filtered={false} filteredLabel="gefiltert" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
