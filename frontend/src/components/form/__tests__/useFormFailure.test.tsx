/**
 * The failure glue every form needs (review fix round 1, lifted out of the
 * lodging form): a refusal stays until the draft changes, and the first
 * problem gets focus after the render that shows it.
 */
import { useState } from "react";
import type { JSX } from "react";
import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FormErrorBanner from "../FormErrorBanner";
import { useFormFailure } from "../useFormFailure";

function SlowSaveForm({ release }: { release: { current: (() => void) | null } }): JSX.Element {
  const [name, setName] = useState("Adlon");
  const failure = useFormFailure(JSON.stringify({ name }));
  // The click starts a save; the answer (a refusal) arrives later, to a
  // handler closed over the render of the click.
  const save = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      release.current = resolve;
    });
    failure.fail("common:saveErrors.validation");
  };
  return (
    <div ref={failure.rootRef}>
      <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" onClick={() => void save()}>
        save
      </button>
      <FormErrorBanner message={failure.failureKey} />
    </div>
  );
}

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

  // Bus review, Minor 1: the dialog stays editable while a save is in flight.
  // The refusal was keyed on the draft of the click, so a letter typed before
  // the answer hid it — the dialog fell back to an enabled Save, saying nothing.
  it("shows a refusal that arrives after an edit made during the save", async () => {
    const release: { current: (() => void) | null } = { current: null };
    render(<SlowSaveForm release={release} />);
    await userEvent.click(screen.getByRole("button", { name: "save" }));
    await userEvent.type(screen.getByLabelText("Name"), "!");

    await act(async () => release.current?.());
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("common:saveErrors.validation");
    await waitFor(() => expect(document.activeElement).toBe(banner));

    // ...and it is still dropped by the NEXT edit after it was shown.
    await userEvent.type(screen.getByLabelText("Name"), "?");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
