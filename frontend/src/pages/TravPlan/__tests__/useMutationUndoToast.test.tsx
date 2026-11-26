import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMutationUndoToast } from "../useMutationUndoToast";
import { useToastStore } from "../../../store/toastStore";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

afterEach(() => {
  useToastStore.getState().clearToasts();
  vi.useRealTimers();
});

describe("useMutationUndoToast", () => {
  it("does not offer an undo for the change the page was opened on", () => {
    renderHook(() => useMutationUndoToast("m1", vi.fn()));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("offers one undoable toast per change made here and undoes that change", () => {
    const onUndo = vi.fn();
    const { rerender } = renderHook(({ id }) => useMutationUndoToast(id, onUndo), {
      initialProps: { id: "m1" },
    });
    rerender({ id: "m2" });
    const [shown] = useToastStore.getState().toasts;
    expect(shown.undo).toBeDefined();
    act(() => shown.undo?.onUndo());
    expect(onUndo).toHaveBeenCalledWith("m2");
  });
});
