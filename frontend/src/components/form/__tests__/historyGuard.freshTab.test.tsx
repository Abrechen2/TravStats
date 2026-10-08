/**
 * Fix round 2 (reproduced by the reviewer): in a tab with NO earlier entry —
 * a fresh tab, a `target=_blank` link, the iPad home-screen app — "Verwerfen"
 * after a Back used `history.go(-2)`, which has nowhere to go and fires no
 * `popstate`. The counter of "our own" pops then stayed at 1, the NEXT real
 * Back on a later dirty form was swallowed as ours, and that form was lost.
 *
 * Its own file on purpose: jsdom keeps one history per test file, and this
 * case needs a history of length 1 at the start.
 */
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "../../Modal";

afterEach(cleanup);

function DirtyModal({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal open onClose={onClose} title="Formular" dirty>
      <p>Inhalt</p>
    </Modal>
  );
}

describe("a tab with no history behind the page", () => {
  it("still asks on Back for the next dirty form after a discard", async () => {
    expect(window.history.length).toBe(1);

    const first = render(<DirtyModal onClose={vi.fn()} />);
    act(() => window.history.back());
    await userEvent.click(await screen.findByRole("button", { name: "common:discard.confirm" }));
    first.unmount();
    // Let whatever the discard set in motion settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const onClose = vi.fn();
    render(<DirtyModal onClose={onClose} />);
    act(() => window.history.back());
    expect(await screen.findByText("common:discard.title")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Inhalt")).toBeInTheDocument());
  });
});
