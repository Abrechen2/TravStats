/**
 * The failure glue every form needs (review fix round 1, lifted out of the
 * lodging form): a refusal stays until the draft changes, and the first
 * problem gets focus after the render that shows it.
 */
import { useState } from "react";
import type { JSX } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FormErrorBanner from "../FormErrorBanner";
import { useFormFailure } from "../useFormFailure";

function Form(): JSX.Element {
  const [name, setName] = useState("Adlon");
  const failure = useFormFailure(JSON.stringify({ name }));
  return (
    <div ref={failure.rootRef}>
      <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" onClick={() => failure.fail("common:saveErrors.network")}>
        fail
      </button>
      <FormErrorBanner message={failure.failureKey} />
    </div>
  );
}

describe("useFormFailure", () => {
  it("shows the refusal, focuses it, and drops it at the next edit", async () => {
    render(<Form />);
    await userEvent.click(screen.getByRole("button", { name: "fail" }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.network");
    await waitFor(() => expect(document.activeElement).toBe(banner));

    await userEvent.type(screen.getByLabelText("Name"), "!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
