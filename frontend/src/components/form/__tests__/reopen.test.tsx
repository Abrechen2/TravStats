/**
 * Fix round 1: a form that stays MOUNTED while closed (`NewRoadtripDialog`
 * keeps rendering with `open=false`) must start over when it re-opens. Before,
 * `useSaveOnce` remembered the first success forever — the second create was
 * silently skipped — and `useDirtyGuard` kept the first opening's baseline.
 */
import { useState } from "react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "../../Modal";
import { useDirtyGuard } from "../useDirtyGuard";
import { useSaveOnce } from "../useSaveOnce";

afterEach(cleanup);

function ReopenableForm({
  open,
  initialName,
  api,
  onDone,
}: {
  open: boolean;
  initialName: string;
  api: (name: string) => Promise<string>;
  onDone: () => void;
}): JSX.Element {
  const [name, setName] = useState(initialName);
  // The form's own job: a fresh draft for a fresh opening.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName(initialName);
  }
  const { dirty } = useDirtyGuard({ name: initialName }, { name }, { open });
  const { save } = useSaveOnce<string>({ open });
  return (
    <Modal open={open} onClose={onDone} title="Neue Tour" dirty={dirty}>
      <span data-testid="dirty">{String(dirty)}</span>
      <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <button
        type="button"
        onClick={() =>
          void save(
            () => api(name),
            () => onDone()
          )
        }
      >
        Speichern
      </button>
    </Modal>
  );
}

function Harness({ api }: { api: (name: string) => Promise<string> }): JSX.Element {
  const [open, setOpen] = useState(true);
  const [initialName, setInitialName] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setInitialName("Vorlage");
          setOpen(true);
        }}
      >
        reopen
      </button>
      <ReopenableForm
        open={open}
        initialName={initialName}
        api={api}
        onDone={() => setOpen(false)}
      />
    </>
  );
}

describe("a dialog that stays mounted and re-opens", () => {
  it("saves again on the second opening, and starts clean from the new initial values", async () => {
    const api = vi.fn(async (name: string) => name);
    render(<Harness api={api} />);

    await userEvent.type(screen.getByLabelText("Name"), "Alpen");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByLabelText("Name")).not.toBeInTheDocument());
    expect(api).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "reopen" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Vorlage");
    // The baseline is the NEW initial value, so an untouched reopened form is clean.
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");

    await userEvent.type(screen.getByLabelText("Name"), " Süd");
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(api).toHaveBeenLastCalledWith("Vorlage Süd");
  });
});
