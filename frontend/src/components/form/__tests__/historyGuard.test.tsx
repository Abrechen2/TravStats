/**
 * Fix round 1: the browser's Back — the button, Alt+←, the iPad's swipe —
 * fires `popstate`, and under `<BrowserRouter>` that unmounted the form
 * without a word; iOS Safari also shows no `beforeunload` prompt at all. While
 * a dialog holds unsaved input, one extra history entry (a "sentinel") now
 * catches that Back and turns it into the same discard question.
 */
import { useState } from "react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "../../Modal";
import { HISTORY_SENTINEL_KEY, openDirtyDialogCount } from "../unsavedChanges";

const onSentinel = (): boolean =>
  Boolean((window.history.state as Record<string, unknown> | null)?.[HISTORY_SENTINEL_KEY]);

beforeEach(() => {
  window.history.replaceState(null, "", "/start");
  window.history.pushState(null, "", "/page");
});

afterEach(async () => {
  cleanup();
  // Let the sentinel's own removal settle before the next test builds history.
  await waitFor(() => expect(onSentinel()).toBe(false));
});

function DirtyModal({ dirty, onClose }: { dirty: boolean; onClose: () => void }): JSX.Element {
  return (
    <Modal open onClose={onClose} title="Formular" dirty={dirty}>
      <p>Inhalt</p>
    </Modal>
  );
}

describe("the history sentinel", () => {
  it("adds no history entry for a clean form", () => {
    const before = window.history.length;
    render(<DirtyModal dirty={false} onClose={vi.fn()} />);
    expect(window.history.length).toBe(before);
    expect(onSentinel()).toBe(false);
  });

  it("asks on Back while dirty, and 'Weiter bearbeiten' stays on the page", async () => {
    const onClose = vi.fn();
    render(<DirtyModal dirty onClose={onClose} />);
    expect(onSentinel()).toBe(true);

    act(() => window.history.back());
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/page");
    // Re-armed, so a second Back is caught as well.
    expect(onSentinel()).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "common:discard.keepEditing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/page");
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
  });

  it("goes back for real on 'Verwerfen'", async () => {
    const onClose = vi.fn();
    render(<DirtyModal dirty onClose={onClose} />);

    act(() => window.history.back());
    await userEvent.click(await screen.findByRole("button", { name: "common:discard.confirm" }));

    await waitFor(() => expect(window.location.pathname).toBe("/start"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("removes the entry without asking once the form is saved (clean again)", async () => {
    const { rerender } = render(<DirtyModal dirty onClose={vi.fn()} />);
    expect(onSentinel()).toBe(true);

    rerender(<DirtyModal dirty={false} onClose={vi.fn()} />);
    await waitFor(() => expect(onSentinel()).toBe(false));
    expect(window.location.pathname).toBe("/page");
    expect(screen.queryByText("common:discard.title")).not.toBeInTheDocument();
  });

  it("is shared: two dirty dialogs, one closes, the guard stays until the last", async () => {
    function Two(): JSX.Element {
      const [first, setFirst] = useState(true);
      const [second, setSecond] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setFirst(false)}>
            close-first
          </button>
          <button type="button" onClick={() => setSecond(false)}>
            close-second
          </button>
          <Modal open={first} onClose={() => setFirst(false)} title="Eins" dirty>
            <p>1</p>
          </Modal>
          <Modal open={second} onClose={() => setSecond(false)} title="Zwei" dirty>
            <p>2</p>
          </Modal>
        </>
      );
    }
    const add = vi.spyOn(window, "addEventListener");
    const before = window.history.length;
    render(<Two />);
    expect(openDirtyDialogCount()).toBe(2);
    // ONE entry and ONE beforeunload listener for both.
    expect(window.history.length).toBe(before + 1);
    expect(add.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(1);

    act(() => screen.getByText("close-first").click());
    expect(openDirtyDialogCount()).toBe(1);
    expect(onSentinel()).toBe(true);

    act(() => screen.getByText("close-second").click());
    expect(openDirtyDialogCount()).toBe(0);
    await waitFor(() => expect(onSentinel()).toBe(false));
    add.mockRestore();
  });
});
