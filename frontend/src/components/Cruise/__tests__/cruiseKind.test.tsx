import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CruiseKindToggle } from "../CruiseKindToggle";
import { cruiseFormFields, cruiseWriteBody } from "../cruiseFormDraft";
import type { Cruise } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** #359: a cruise is ocean or river, and the form says which and sends it. */
describe("cruise kind (#359)", () => {
  it("starts a new cruise as ocean and keeps a stored river cruise river", () => {
    expect(cruiseFormFields(undefined, "EUR").kind).toBe("ocean");
    const river = { kind: "river" } as unknown as Cruise;
    expect(cruiseFormFields(river, "EUR").kind).toBe("river");
  });

  it("sends the kind with the write body", () => {
    const fields = { ...cruiseFormFields(undefined, "EUR"), kind: "river" as const };
    expect(cruiseWriteBody(fields).kind).toBe("river");
  });

  it("names both answers and reports the one picked", () => {
    const onChange = vi.fn();
    render(<CruiseKindToggle value="ocean" onChange={onChange} />);
    expect(screen.getByLabelText("kind.ocean")).toBeChecked();
    fireEvent.click(screen.getByLabelText("kind.river"));
    expect(onChange).toHaveBeenCalledWith("river");
  });
});
