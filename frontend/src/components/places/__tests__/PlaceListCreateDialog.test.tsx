/**
 * A new list on the shared form blocks (forgejo#245–#249). It was an inline
 * panel whose greyed-out save said nothing and whose refusal was a toast.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlaceList } from "../../../types/placeList";

const createPlaceList = vi.fn();
vi.mock("../../../lib/api/placeLists", () => ({
  createPlaceList: (...a: unknown[]) => createPlaceList(...a),
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
// The emoji picker behind the symbol field cannot load in a symlinked
// worktree, and is not what this file is about.
vi.mock("../PlaceListLabelFields", () => ({
  PlaceListLabelFields: () => null,
  hasSymbol: (v: string) => v.trim().length > 0,
}));

import { PlaceListCreateDialog } from "../PlaceListCreateDialog";

const created = { id: "l-new", name: "Burgen" } as PlaceList;
const save = (): HTMLElement => screen.getByRole("button", { name: "Speichern" });

describe("PlaceListCreateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPlaceList.mockResolvedValue(created);
  });

  it("marks the name required and says why save is greyed out", async () => {
    render(<PlaceListCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    const name = screen.getByRole("textbox", { name: /^Name/ });
    expect(name).toHaveAttribute("aria-required", "true");
    expect(save()).toBeDisabled();
    expect(screen.getByTestId("save-blocked-hint")).toHaveTextContent("Name");
    fireEvent.change(name, { target: { value: "Burgen" } });
    expect(save()).toBeEnabled();
  });

  it("creates once, however often it is tapped, and moves on", async () => {
    let resolve: (l: PlaceList) => void = () => {};
    createPlaceList.mockReturnValue(new Promise<PlaceList>((r) => (resolve = r)));
    const onCreated = vi.fn();
    render(<PlaceListCreateDialog onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Burgen" },
    });
    const button = save();
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => resolve(created));
    expect(createPlaceList).toHaveBeenCalledTimes(1);
    expect(createPlaceList).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Burgen", icon: null, labelMode: "name" })
    );
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("keeps the input on a refusal, says why in the dialog, and offers a retry", async () => {
    // A refusal the server answered (nothing stored), so a create may retry.
    createPlaceList
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 503, data: { code: "DB_UNAVAILABLE" } },
      })
      .mockResolvedValueOnce(created);
    const onCreated = vi.fn();
    render(<PlaceListCreateDialog onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Burgen" },
    });
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Datenbank ist gerade nicht erreichbar"
    );
    expect(screen.getByRole("textbox", { name: /^Name/ })).toHaveValue("Burgen");
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  });

  // Bus review, Minor 2 (integration wiring): the list may be stored.
  it("offers no retry after a create whose answer was lost, and offers a reload instead", async () => {
    createPlaceList.mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" });
    const onReload = vi.fn();
    render(<PlaceListCreateDialog onClose={vi.fn()} onCreated={vi.fn()} onReload={onReload} />);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Burgen" },
    });
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Ob gespeichert wurde, ist unklar");
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull();
    expect(screen.getByRole("textbox", { name: /^Name/ })).toHaveValue("Burgen");
    fireEvent.click(screen.getByRole("button", { name: "Liste neu laden" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(createPlaceList).toHaveBeenCalledTimes(1);
  });

  it("asks before a typed name is dropped; an untouched dialog closes at once", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<PlaceListCreateDialog onClose={onClose} onCreated={vi.fn()} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const onCloseTyped = vi.fn();
    render(<PlaceListCreateDialog onClose={onCloseTyped} onCreated={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: /^Name/ }), "B");
    await userEvent.keyboard("{Escape}");
    expect(onCloseTyped).not.toHaveBeenCalled();
    expect(screen.getByText("Änderungen verwerfen?")).toBeInTheDocument();
  });

  it("says which colour is chosen and gives each swatch a touch-sized box", () => {
    render(<PlaceListCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    const swatches = screen.getByRole("group", { name: "Farbe" }).querySelectorAll("button");
    expect(swatches[0]).toHaveAttribute("aria-pressed", "true");
    expect(swatches[1]).toHaveAttribute("aria-pressed", "false");
    expect(swatches[1].className).toContain("pointer-coarse:min-w-(--ts-size-touch-min)");
  });
});
