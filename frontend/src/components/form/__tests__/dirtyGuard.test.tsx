/**
 * forgejo#248: a changed form must not vanish on a stray Escape, a click
 * beside it or the ×. Before this every form in all eight domains closed on
 * each of them at once and dropped the draft.
 *
 * Both frames are covered, because a form can sit in either, and each close
 * path separately, because they are wired separately — a guard on Escape that
 * forgot the scrim protects nothing for a touch user.
 */
import { useState } from "react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "../../Modal";
import Dialog from "../../ui/Dialog";
import { useDirtyGuard } from "../useDirtyGuard";
import { openDirtyDialogCount } from "../useDiscardGuard";

afterEach(cleanup);

type Frame = "Modal" | "Dialog";

function renderFrame(
  frame: Frame,
  props: { dirty?: boolean; busy?: boolean } = {}
): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  if (frame === "Modal") {
    render(
      <Modal
        open
        onClose={onClose}
        title="Formular"
        closeLabel="Schließen"
        footer={(requestClose) => (
          <button type="button" onClick={requestClose}>
            Abbrechen
          </button>
        )}
        {...props}
      >
        <p>Inhalt</p>
      </Modal>
    );
  } else {
    render(
      <Dialog open onClose={onClose} title="Formular" dismissLabel="Abbrechen" {...props}>
        <p>Inhalt</p>
      </Dialog>
    );
  }
  return { onClose };
}

function scrimOf(frame: Frame): HTMLElement {
  const panel = screen.getByRole("dialog", { name: frame === "Modal" ? "Formular" : undefined });
  const scrim = panel.closest(".ts-dialog-scrim");
  if (!(scrim instanceof HTMLElement)) throw new Error("no scrim");
  return scrim;
}

const closePaths: Array<[string, (frame: Frame) => Promise<void>]> = [
  [
    "Escape",
    async () => {
      await userEvent.keyboard("{Escape}");
    },
  ],
  ["a click beside it", async (frame) => userEvent.click(scrimOf(frame))],
  ["the ×", async () => userEvent.click(screen.getByRole("button", { name: "Schließen" }))],
  [
    "its own Cancel",
    async () => userEvent.click(screen.getByRole("button", { name: "Abbrechen" })),
  ],
];

describe.each<Frame>(["Modal", "Dialog"])("%s with unsaved input", (frame) => {
  it.each(closePaths)("asks before %s closes it", async (_label, close) => {
    const { onClose } = renderFrame(frame, { dirty: true });
    await close(frame);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("common:discard.title")).toBeInTheDocument();
    expect(screen.getByText("common:discard.message")).toBeInTheDocument();
  });

  it("stays open on 'Weiter bearbeiten'", async () => {
    const { onClose } = renderFrame(frame, { dirty: true });
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "common:discard.keepEditing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("common:discard.title")).not.toBeInTheDocument();
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
  });

  it("an Escape on the question answers the question, not the form", async () => {
    const { onClose } = renderFrame(frame, { dirty: true });
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("common:discard.title")).not.toBeInTheDocument();
  });

  it("closes on 'Verwerfen'", async () => {
    const { onClose } = renderFrame(frame, { dirty: true });
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "common:discard.confirm" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(closePaths)("an unchanged form closes on %s without asking", async (_label, close) => {
    const { onClose } = renderFrame(frame, { dirty: false });
    await close(frame);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("common:discard.title")).not.toBeInTheDocument();
  });

  it("a save in flight still blocks every close path", async () => {
    const { onClose } = renderFrame(frame, { dirty: true, busy: true });
    await userEvent.keyboard("{Escape}");
    await userEvent.click(scrimOf(frame));
    await userEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("common:discard.title")).not.toBeInTheDocument();
  });
});

describe("beforeunload", () => {
  function Harness(): JSX.Element {
    const [dirty, setDirty] = useState(false);
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setDirty((d) => !d)}>
          toggle-dirty
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          unmount-dialog
        </button>
        <Modal open={open} onClose={() => setOpen(false)} title="Formular" dirty={dirty}>
          <p>Inhalt</p>
        </Modal>
      </>
    );
  }

  it("is registered only while a dialog holds unsaved input", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    render(<Harness />);
    const registered = (): number =>
      add.mock.calls.filter(([type]) => type === "beforeunload").length -
      remove.mock.calls.filter(([type]) => type === "beforeunload").length;

    expect(registered()).toBe(0);
    act(() => screen.getByText("toggle-dirty").click());
    expect(registered()).toBe(1);
    expect(openDirtyDialogCount()).toBe(1);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    act(() => screen.getByText("unmount-dialog").click());
    expect(registered()).toBe(0);
    expect(openDirtyDialogCount()).toBe(0);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("useDirtyGuard", () => {
  it("is clean until the draft differs, and clean again once it matches", () => {
    const { result, rerender } = renderHook(({ draft }) => useDirtyGuard({ name: "" }, draft), {
      initialProps: { draft: { name: "" } },
    });
    expect(result.current.dirty).toBe(false);
    rerender({ draft: { name: "A" } });
    expect(result.current.dirty).toBe(true);
    // Typing a letter and deleting it again is no change.
    rerender({ draft: { name: "" } });
    expect(result.current.dirty).toBe(false);
  });

  // Fix round 1: a plain JSON.stringify called a form "changed" when only the
  // key order or the spelling of "empty" differed — an edit form built from a
  // record with `null` and a draft holding "" opened already dirty.
  it("ignores key order", () => {
    const { result } = renderHook(() => useDirtyGuard({ a: 1, b: "x" }, { b: "x", a: 1 }));
    expect(result.current.dirty).toBe(false);
  });

  it("treats undefined, null, an empty string and an absent key as the same empty", () => {
    const { result, rerender } = renderHook(
      ({ draft }: { draft: Record<string, unknown> }) =>
        useDirtyGuard({ a: undefined, b: null, nested: { c: "" } }, draft),
      { initialProps: { draft: { a: "", b: "", nested: {} } as Record<string, unknown> } }
    );
    expect(result.current.dirty).toBe(false);
    rerender({ draft: { nested: { c: null } } });
    expect(result.current.dirty).toBe(false);
    rerender({ draft: { a: "x", nested: {} } });
    expect(result.current.dirty).toBe(true);
  });

  it("still sees a real change inside an array or a nested object", () => {
    const { result } = renderHook(() =>
      useDirtyGuard({ tags: ["a"], meta: { n: 1 } }, { tags: ["a", "b"], meta: { n: 1 } })
    );
    expect(result.current.dirty).toBe(true);
  });

  it("reads the initial values once — a parent's fresh object does not move the baseline", () => {
    const { result, rerender } = renderHook(({ initial, draft }) => useDirtyGuard(initial, draft), {
      initialProps: { initial: { name: "Alt" }, draft: { name: "Neu" } },
    });
    expect(result.current.dirty).toBe(true);
    rerender({ initial: { name: "Neu" }, draft: { name: "Neu" } });
    expect(result.current.dirty).toBe(true);
  });

  it("markSaved ends the protection for what was saved", () => {
    const { result, rerender } = renderHook(({ draft }) => useDirtyGuard({ name: "" }, draft), {
      initialProps: { draft: { name: "Hotel" } },
    });
    act(() => result.current.markSaved());
    expect(result.current.dirty).toBe(false);
    rerender({ draft: { name: "Hotel Adlon" } });
    expect(result.current.dirty).toBe(true);
  });
});
