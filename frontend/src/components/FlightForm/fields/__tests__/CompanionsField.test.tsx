import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import CompanionsField from "../CompanionsField";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../../../CompanionPicker", () => ({
  default: ({ value }: { value: string[] }) => (
    <div data-testid="companion-picker">{value.join(",")}</div>
  ),
}));

describe("CompanionsField", () => {
  it("renders the picker, and no parsed row when there are no co-passengers", () => {
    render(<CompanionsField companions={["Anna"]} onCompanionsChange={() => {}} />);

    expect(screen.getByTestId("companion-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("co-passengers-row")).not.toBeInTheDocument();
  });

  it("shows the parsed names read-only — there is no input for them", () => {
    const { container } = render(
      <CompanionsField
        companions={[]}
        onCompanionsChange={() => {}}
        coPassengers={["Jonas Weber", "Mia Weber"]}
      />
    );

    expect(screen.getByTestId("co-passengers-row").textContent).toContain("Jonas Weber");
    expect(screen.getByTestId("co-passengers-row").textContent).toContain("Mia Weber");
    // Read-only means read-only: the row contains no form control besides
    // the take-over button.
    expect(container.querySelectorAll("input").length).toBe(0);
  });

  it("take over copies the names into companions WITHOUT mutating coPassengers", () => {
    const onCompanionsChange = vi.fn();
    const coPassengers = ["Jonas Weber", "Mia Weber"];
    render(
      <CompanionsField
        companions={["Anna"]}
        onCompanionsChange={onCompanionsChange}
        coPassengers={coPassengers}
      />
    );

    fireEvent.click(screen.getByTestId("co-passengers-take-over"));

    expect(onCompanionsChange).toHaveBeenCalledWith(["Anna", "Jonas Weber", "Mia Weber"]);
    expect(coPassengers).toEqual(["Jonas Weber", "Mia Weber"]);
  });

  it("lists only names not yet in companions, and hides the row once all are taken", () => {
    const { rerender } = render(
      <CompanionsField
        companions={["Jonas Weber"]}
        onCompanionsChange={() => {}}
        coPassengers={["Jonas Weber", "Mia Weber"]}
      />
    );

    const row = screen.getByTestId("co-passengers-row");
    expect(row.textContent).toContain("Mia Weber");
    expect(row.textContent).not.toContain("Jonas Weber");

    // Parent state catches up after a take-over → the row disappears. This
    // is the asserted post-take-over presentation: gone, not "taken".
    rerender(
      <CompanionsField
        companions={["Jonas Weber", "Mia Weber"]}
        onCompanionsChange={() => {}}
        coPassengers={["Jonas Weber", "Mia Weber"]}
      />
    );
    expect(screen.queryByTestId("co-passengers-row")).not.toBeInTheDocument();
  });
});
