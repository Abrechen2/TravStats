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
];

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
});
