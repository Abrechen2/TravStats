import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.hoisted lets these vi.fn()s survive vi.mock factory hoisting and stay
// reachable from the test bodies below (see ImmichConnectionCard.test.tsx).
const { listAlbums, estimateImport, linkAlbums } = vi.hoisted(() => ({
  listAlbums: vi.fn(),
  estimateImport: vi.fn(),
  linkAlbums: vi.fn(),
}));
const KNOWN_FAILURE_KINDS = [
  "notConfigured",
  "unreachable",
  "auth",
  "notFound",
  "protocol",
  "invalidUrl",
];
vi.mock("../../../lib/api/immich", () => ({
  immichApi: { listAlbums, estimateImport, linkAlbums },
  immichFailureKind: (e: unknown) =>
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? null,
  failureKey: (kind: unknown) =>
    typeof kind === "string" && KNOWN_FAILURE_KINDS.includes(kind)
      ? `errors.${kind}`
      : "errors.unknown",
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {}, ready: true }),
}));

import ImmichAlbumPicker, { formatBytes } from "../ImmichAlbumPicker";

const ALBUMS = [
  {
    id: "a1",
    albumName: "Rome",
    assetCount: 12,
    thumbnailAssetId: "t1",
    linked: false,
    linkId: null,
  },
  {
    id: "a2",
    albumName: "Oslo",
    assetCount: 4,
    thumbnailAssetId: null,
    linked: true,
    linkId: "l2",
  },
  {
    id: "a3",
    albumName: "Paris",
    assetCount: 8,
    thumbnailAssetId: null,
    linked: false,
    linkId: null,
  },
];

const MUENCHEN_ALBUM = {
  id: "a4",
  albumName: "München 2024",
  assetCount: 20,
  thumbnailAssetId: null,
  linked: false,
  linkId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  listAlbums.mockResolvedValue({ albums: ALBUMS, defaultMode: "link" });
  estimateImport.mockResolvedValue({ assetCount: 12, totalBytes: 25_000_000 });
  linkAlbums.mockResolvedValue({ links: [] });
});

describe("formatBytes", () => {
  it("renders human-readable sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(25_000_000)).toBe("23.8 MB");
    expect(formatBytes(3_221_225_472)).toBe("3.0 GB");
  });
});

describe("ImmichAlbumPicker", () => {
  const renderPicker = () =>
    render(<ImmichAlbumPicker tripId="trip-1" onClose={vi.fn()} onLinked={vi.fn()} />);

  it("lists albums and disables the ones already linked", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());

    expect(screen.getByRole("checkbox", { name: /Rome/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Oslo/ })).toBeDisabled();
    expect(screen.getByText("albums.alreadyLinked")).toBeInTheDocument();
  });

  it("links the selected album in the default mode", async () => {
    const onLinked = vi.fn();
    render(<ImmichAlbumPicker tripId="trip-1" onClose={vi.fn()} onLinked={onLinked} />);
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));
    await user.click(screen.getByRole("button", { name: /albums.confirm/ }));

    await waitFor(() =>
      expect(linkAlbums).toHaveBeenCalledWith("trip-1", [{ immichAlbumId: "a1", mode: "link" }])
    );
    expect(onLinked).toHaveBeenCalled();
  });

  it("fetches and shows a storage estimate only when an album is switched to import", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));
    expect(estimateImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "modeImport" }));

    await waitFor(() => expect(estimateImport).toHaveBeenCalledWith("trip-1", "a1"));
    await waitFor(() => expect(screen.getByText("albums.estimate")).toBeInTheDocument());
  });

  it("fetches and shows a storage estimate when the user's default mode is import", async () => {
    listAlbums.mockResolvedValue({ albums: ALBUMS, defaultMode: "import" });
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));

    await waitFor(() => expect(estimateImport).toHaveBeenCalledTimes(1));
    expect(estimateImport).toHaveBeenCalledWith("trip-1", "a1");
    await waitFor(() => expect(screen.getByText("albums.estimate")).toBeInTheDocument());
  });

  it("issues no estimate request when the user's default mode is link", async () => {
    renderPicker(); // beforeEach sets defaultMode: "link"
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));

    expect(estimateImport).not.toHaveBeenCalled();
  });

  it("does not resurrect a deselected album when its in-flight estimate resolves", async () => {
    listAlbums.mockResolvedValue({ albums: ALBUMS, defaultMode: "import" });
    let resolveEstimate: (value: { assetCount: number; totalBytes: number }) => void = () => {};
    estimateImport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEstimate = resolve;
        })
    );
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));
    await waitFor(() => expect(estimateImport).toHaveBeenCalledTimes(1));

    // Deselect before the in-flight estimate resolves.
    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));
    expect(screen.getByRole("checkbox", { name: /Rome/ })).not.toBeChecked();

    await act(async () => {
      resolveEstimate({ assetCount: 12, totalBytes: 25_000_000 });
      await Promise.resolve();
    });

    expect(screen.getByRole("checkbox", { name: /Rome/ })).not.toBeChecked();
    expect(screen.queryByText("albums.estimate")).not.toBeInTheDocument();
  });

  it("does not link anything when nothing is selected", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /albums.confirm/ })).toBeDisabled();
    expect(linkAlbums).not.toHaveBeenCalled();
  });

  it("shows a degraded panel when Immich is unconfigured", async () => {
    listAlbums.mockRejectedValue({ response: { data: { error: "notConfigured" } } });
    renderPicker();
    await waitFor(() => expect(screen.getByText("errors.notConfigured")).toBeInTheDocument());
  });

  // An unrecognised backend failure kind must degrade to the neutral
  // "errors.unknown" panel — never "errors.unreachable", which would falsely
  // assert a network failure that was never established.
  it("renders errors.unknown (not errors.unreachable) for an unrecognised failure kind", async () => {
    listAlbums.mockRejectedValue({ response: { data: { error: "brand-new-kind" } } });
    renderPicker();
    await waitFor(() => expect(screen.getByText("errors.unknown")).toBeInTheDocument());
    expect(screen.queryByText("errors.unreachable")).not.toBeInTheDocument();
  });

  it("shows an empty state when Immich has no albums", async () => {
    listAlbums.mockResolvedValue({ albums: [], defaultMode: "link" });
    renderPicker();
    await waitFor(() => expect(screen.getByText("albums.empty")).toBeInTheDocument());
  });

  it("filters the album list by name as the user types", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "albums.searchLabel" }), "Ro");

    expect(screen.getByText("Rome")).toBeInTheDocument();
    expect(screen.queryByText("Oslo")).not.toBeInTheDocument();
    expect(screen.queryByText("Paris")).not.toBeInTheDocument();
  });

  it("matches album names case-insensitively", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "albums.searchLabel" }), "rOME");

    expect(screen.getByText("Rome")).toBeInTheDocument();
    expect(screen.queryByText("Oslo")).not.toBeInTheDocument();
  });

  it("matches diacritic album names against a plain-ASCII query, regardless of case", async () => {
    listAlbums.mockResolvedValue({ albums: [...ALBUMS, MUENCHEN_ALBUM], defaultMode: "link" });
    renderPicker();
    await waitFor(() => expect(screen.getByText("München 2024")).toBeInTheDocument());
    const user = userEvent.setup();
    const search = screen.getByRole("textbox", { name: "albums.searchLabel" });

    await user.type(search, "munchen");
    expect(screen.getByText("München 2024")).toBeInTheDocument();
    expect(screen.queryByText("Rome")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "München");
    expect(screen.getByText("München 2024")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "MUNCHEN");
    expect(screen.getByText("München 2024")).toBeInTheDocument();
  });

  it("treats a whitespace-only query as no filter at all", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "albums.searchLabel" }), "   ");

    expect(screen.getByText("Rome")).toBeInTheDocument();
    expect(screen.getByText("Oslo")).toBeInTheDocument();
    expect(screen.getByText("Paris")).toBeInTheDocument();
    expect(screen.queryByText("albums.noMatches")).not.toBeInTheDocument();
  });

  it("keeps a selection alive after the matching album is filtered out of view", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();
    const search = screen.getByRole("textbox", { name: "albums.searchLabel" });

    // Search "Rome", select it, then search "Paris" and select that too — Rome
    // is no longer rendered but must still be part of the confirm payload.
    await user.type(search, "Rome");
    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));

    await user.clear(search);
    await user.type(search, "Paris");
    expect(screen.queryByText("Rome")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Paris/ }));

    // Confirm while the "Paris" filter is still active — Rome is hidden at
    // the moment of confirm, so a handleConfirm that only submits the
    // currently-visible selections would silently drop it here.
    await user.click(screen.getByRole("button", { name: /albums.confirm/ }));

    await waitFor(() => expect(linkAlbums).toHaveBeenCalledTimes(1));
    const [, payload] = linkAlbums.mock.calls[0] as [string, { immichAlbumId: string }[]];
    expect(payload).toHaveLength(2);
    expect(payload).toEqual(
      expect.arrayContaining([
        { immichAlbumId: "a1", mode: "link" },
        { immichAlbumId: "a3", mode: "link" },
      ])
    );
  });

  it("shows a distinct no-matches message instead of the no-albums empty state", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "albums.searchLabel" }), "zzz-no-match");

    expect(screen.getByText("albums.noMatches")).toBeInTheDocument();
    expect(screen.queryByText("albums.empty")).not.toBeInTheDocument();
  });

  it("does not strand the user behind an unclearable search filter after a failed confirm", async () => {
    linkAlbums.mockRejectedValue({ response: { data: { error: "unreachable" } } });
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();
    const search = screen.getByRole("textbox", { name: "albums.searchLabel" });

    await user.type(search, "Rome");
    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));
    await user.click(screen.getByRole("button", { name: /albums.confirm/ }));

    await waitFor(() => expect(screen.getByText("errors.unreachable")).toBeInTheDocument());

    // The search box must still be reachable after a failed confirm so the
    // user can clear the leftover filter themselves — the only alternative
    // today is closing and reopening the whole picker.
    const searchAfterFailure = screen.getByRole("textbox", { name: "albums.searchLabel" });
    await user.clear(searchAfterFailure);
    expect(screen.getByText("Oslo")).toBeInTheDocument();
    expect(screen.getByText("Paris")).toBeInTheDocument();
  });

  it("shows a hint when a selected album is hidden by the current search filter", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();
    const search = screen.getByRole("textbox", { name: "albums.searchLabel" });

    await user.type(search, "Rome");
    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));

    // Rome (selected) is now hidden by a filter for a different album.
    await user.clear(search);
    await user.type(search, "Paris");

    expect(screen.getByText("albums.hiddenSelections")).toBeInTheDocument();
  });

  it("does not show the hidden-selections hint when every selected album is visible", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox", { name: /Rome/ }));

    expect(screen.queryByText("albums.hiddenSelections")).not.toBeInTheDocument();
  });

  it("restores the full album list once the query is cleared", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Rome")).toBeInTheDocument());
    const user = userEvent.setup();
    const search = screen.getByRole("textbox", { name: "albums.searchLabel" });

    await user.type(search, "Rome");
    expect(screen.queryByText("Oslo")).not.toBeInTheDocument();

    await user.clear(search);

    expect(screen.getByText("Rome")).toBeInTheDocument();
    expect(screen.getByText("Oslo")).toBeInTheDocument();
    expect(screen.getByText("Paris")).toBeInTheDocument();
  });
});
