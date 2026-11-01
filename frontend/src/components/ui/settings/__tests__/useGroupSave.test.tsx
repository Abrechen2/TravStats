import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGroupSave } from "../useGroupSave";

type Draft = { url: string; secret: string };

describe("useGroupSave — a write that settles the draft", () => {
  it("keeps what the user typed while the request was out, and only settles the other fields", async () => {
    let release: () => void = () => {};
    const { result } = renderHook(() =>
      useGroupSave<Draft>({
        id: "g",
        label: "g",
        saved: { url: "a", secret: "" },
        write: (draft) =>
          new Promise((resolve) => {
            release = () => resolve({ ...draft, secret: "" });
          }),
      })
    );
    act(() => result.current.edit({ url: "b", secret: "typed" }));
    let saving: Promise<boolean> = Promise.resolve(false);
    act(() => {
      saving = result.current.save();
    });
    // The user edits the URL again while the request is out.
    act(() => result.current.edit({ url: "c" }));
    await act(async () => {
      release();
      await saving;
    });
    expect(result.current.draft).toEqual({ url: "c", secret: "" });
    expect(result.current.isChanged("url")).toBe(true);
    expect(result.current.isChanged("secret")).toBe(false);
  });
});
