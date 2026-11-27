/**
 * rc.48: a server 400 VALIDATION_FAILED names its fields in `details[].field`. The forms read
 * only the code and said "some details are not valid" in a banner above thirty fields. Now the
 * message sits at the field, the field is told (aria), focus goes to the first, and a field no
 * control answers to keeps the banner — nothing is hidden.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { JSX } from "react";
import FieldErrorsHost from "../FieldErrorsHost";
import FormErrorBanner from "../FormErrorBanner";
import { useFormFailure } from "../useFormFailure";
import { findFieldControl, validationIssues } from "../../../lib/validationFieldErrors";

afterEach(cleanup);

const refusal = (details: Array<{ field: string; message: string }>): unknown => ({
  isAxiosError: true,
  response: {
    status: 400,
    data: { error: "Validation error", code: "VALIDATION_FAILED", details },
  },
});

let latest: ReturnType<typeof useFormFailure>;
function Form(): JSX.Element {
  const [name, setName] = useState("");
  const failure = useFormFailure(name);
  latest = failure;
  return (
    <div ref={failure.rootRef}>
      <label htmlFor="trip-form-start-date">Start</label>
      <input id="trip-form-start-date" />
      <label htmlFor="n">Name</label>
      <input id="n" name="tripName" value={name} onChange={(e) => setName(e.target.value)} />
      <FieldErrorsHost failure={failure} />
      <FormErrorBanner message={failure.bannerKey} />
    </div>
  );
}

describe("validation refusals at the field", () => {
  it("reads the issues of a refused body and ignores any other error", () => {
    expect(
      validationIssues(
        refusal([
          { field: "startDate", message: "Invalid input: expected string, received undefined" },
          { field: "tripName", message: "Too long" },
        ])
      )
    ).toEqual([
      { field: "startDate", kind: "required" },
      { field: "tripName", kind: "invalid" },
    ]);
    expect(validationIssues({ response: { status: 500, data: { code: "X" } } })).toEqual([]);
  });

  it("finds a control by data-field, name, id or a form's own `<form>-<kebab field>` id", () => {
    const root = document.createElement("div");
    root.innerHTML = '<input id="trip-form-start-date"/><input name="tripName"/>';
    expect(findFieldControl(root, "startDate")?.id).toBe("trip-form-start-date");
    expect(findFieldControl(root, "tripName")?.getAttribute("name")).toBe("tripName");
    expect(findFieldControl(root, "nothing")).toBeNull();
  });

  it("shows each issue at its field, marks the control, and drops the banner it replaces", () => {
    render(<Form />);
    act(() =>
      latest.fail(
        "common:saveErrors.validation",
        refusal([
          { field: "startDate", message: "Invalid input: expected string, received undefined" },
          { field: "tripName", message: "Too small" },
        ])
      )
    );
    const start = screen.getByLabelText("Start");
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(start).toHaveAccessibleDescription("common:fieldErrors.required");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("common:fieldErrors.invalid");
    expect(document.activeElement).toBe(start);
    expect(screen.queryByText("common:saveErrors.validation")).toBeNull();
  });

  it("keeps the banner when an issue names no field of the form", () => {
    render(<Form />);
    act(() =>
      latest.fail(
        "common:saveErrors.validation",
        refusal([
          { field: "startDate", message: "Invalid input" },
          { field: "somethingElse", message: "Invalid input" },
        ])
      )
    );
    expect(screen.getByLabelText("Start")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("common:saveErrors.validation")).toBeInTheDocument();
  });

  it("keeps the banner for a refusal without details, and clears the field errors on edit", () => {
    render(<Form />);
    act(() => latest.fail("common:saveErrors.validation", refusal([])));
    expect(screen.getByText("common:saveErrors.validation")).toBeInTheDocument();

    act(() =>
      latest.fail("common:saveErrors.validation", refusal([{ field: "startDate", message: "x" }]))
    );
    expect(screen.getByLabelText("Start")).toHaveAttribute("aria-invalid", "true");
    act(() => {
      screen.getByLabelText("Name").focus();
    });
    // The next edit ends the refusal.
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "x");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(screen.getByLabelText("Start")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByTestId("field-error")).toBeNull();
  });
});
