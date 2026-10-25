import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

type Caps = {
  version: 1;
  offered: boolean;
  enabled: boolean;
  active: boolean;
  hasData: boolean;
  sources?: Array<"companion" | "gpx" | "owntracks" | "overland">;
};
const ALL: Caps["sources"] = ["companion", "gpx", "owntracks", "overland"];
const caps = vi.hoisted(() => ({ current: null as unknown as Caps }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackCapabilities: () => caps.current,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      isInitialized: true,
    },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
const demo = vi.hoisted(() => ({ current: false }));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo.current }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: () => true }),
}));
// The trip note reads the home periods on its own; covered by TravTrackTripNote.test.tsx.
vi.mock("../TravTrackTripNote", () => ({ default: () => null }));
vi.mock("../../../hooks/useTodayZone", () => ({
  useTodayZone: () => "UTC",
  todayZoneNow: () => "UTC",
}));

import TravTrackSection from "../TravTrackSection";
import { travTrackApi } from "../../../lib/api/travtrack";
import { travTrackImportsApi } from "../../../lib/api/travtrackImports";
import {
  sourcesErrorKey,
  travTrackSourcesApi,
  type IngestToken,
} from "../../../lib/api/travtrackSources";

/**
 * OwnTracks and Overland in Settings (TravTrack plan E9): a token is created
 * for a named device and shown once with the URL and the app's field names;
 * the list carries no token; revoking asks first; every refusal reads as its
 * own sentence.
 */

const EMPTY = {
  pointCount: 0,
  firstAt: null,
  lastAt: null,
  lastReceivedAt: null,
  devices: [],
  deletedRanges: 0,
  zones: 0,
};

const PIXEL: IngestToken = {
  id: "tok-1",
  kind: "owntracks",
  label: "Pixel",
  createdAt: "2026-10-20T10:00:00.000Z",
  lastUsedAt: null,
};

const SECRET = `tt_ingest_${"ab".repeat(32)}`;

const show = () =>
  render(
    <MemoryRouter>
      <TravTrackSection />
    </MemoryRouter>
  );

async function confirmInDialog() {
  const dialog = await screen.findByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  await userEvent.click(buttons[buttons.length - 1]);
}

describe("TravTrackSection — further sources", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    demo.current = false;
    caps.current = {
      version: 1,
      offered: true,
      enabled: true,
      active: true,
      hasData: true,
      sources: ALL,
    };
    vi.spyOn(travTrackApi, "summary").mockResolvedValue(EMPTY);
    vi.spyOn(travTrackApi, "zones").mockResolvedValue([]);
    vi.spyOn(travTrackImportsApi, "list").mockResolvedValue([]);
    vi.spyOn(travTrackSourcesApi, "list").mockResolvedValue([]);
  });

  it("creates an OwnTracks token and shows it once with the URL and the app's field names", async () => {
    const create = vi.spyOn(travTrackSourcesApi, "create").mockResolvedValue({
      ...PIXEL,
      token: SECRET,
      url: "https://trav.example/api/v1/travtrack/ingest/owntracks",
    });
    show();
    await userEvent.type(await screen.findByLabelText("track:sources.label"), "Pixel");
    await userEvent.click(screen.getByRole("button", { name: "track:sources.create" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ kind: "owntracks", label: "Pixel" }));
    const panel = await screen.findByTestId("travtrack-source-created");
    expect(within(panel).getByLabelText("track:sources.owntracks.password")).toHaveValue(SECRET);
    expect(within(panel).getByLabelText("track:sources.owntracks.url")).toHaveValue(
      "https://trav.example/api/v1/travtrack/ingest/owntracks"
    );
    expect(panel).toHaveTextContent("track:sources.shownOnce");
    // Gone once dismissed: the page never shows it again.
    await userEvent.click(within(panel).getByRole("button", { name: "track:sources.done" }));
    expect(screen.queryByTestId("travtrack-source-created")).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("an Overland token names Overland's own fields", async () => {
    vi.spyOn(travTrackSourcesApi, "create").mockResolvedValue({
      ...PIXEL,
      kind: "overland",
      token: SECRET,
      url: "https://trav.example/api/v1/travtrack/ingest/overland",
    });
    show();
    await userEvent.selectOptions(await screen.findByLabelText("track:sources.kind"), "overland");
    await userEvent.type(screen.getByLabelText("track:sources.label"), "iPhone");
    await userEvent.click(screen.getByRole("button", { name: "track:sources.create" }));
    const panel = await screen.findByTestId("travtrack-source-created");
    expect(within(panel).getByLabelText("track:sources.overland.token")).toHaveValue(SECRET);
    expect(within(panel).getByLabelText("track:sources.overland.url")).toBeInTheDocument();
  });

  it("says that zones are applied on the server for these apps", async () => {
    show();
    expect(await screen.findByTestId("travtrack-sources-privacy")).toHaveTextContent(
      "track:sources.privacy"
    );
  });

  it("lists the tokens and revokes one only after asking", async () => {
    vi.spyOn(travTrackSourcesApi, "list").mockResolvedValue([PIXEL]);
    const revoke = vi.spyOn(travTrackSourcesApi, "revoke").mockResolvedValue(undefined);
    show();
    const row = (await screen.findByText(/^Pixel/)).closest("li")!;
    expect(row).toHaveTextContent("track:sources.neverUsed");
    await userEvent.click(within(row).getByRole("button", { name: "track:sources.revoke" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent('"name":"Pixel"');
    await confirmInDialog();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("tok-1"));
  });

  it("a refusal reads as its own sentence", async () => {
    vi.spyOn(travTrackSourcesApi, "create").mockRejectedValue({
      response: { status: 409, data: { code: "TRAVTRACK_NOT_ACTIVE" } },
    });
    show();
    await userEvent.type(await screen.findByLabelText("track:sources.label"), "Pixel");
    await userEvent.click(screen.getByRole("button", { name: "track:sources.create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("track:sources.errors.notActive");
    const of = (status: number, code?: string) => ({ response: { status, data: { code } } });
    expect(sourcesErrorKey(of(409, "INGEST_TOKEN_LIMIT"))).toBe("track:sources.errors.limit");
    expect(sourcesErrorKey(of(404, "INGEST_TOKEN_NOT_FOUND"))).toBe(
      "track:sources.errors.notFound"
    );
    expect(sourcesErrorKey(of(429))).toBe("track:sources.errors.rateLimited");
    expect(sourcesErrorKey(of(403, "TRAVTRACK_DISABLED"))).toBe("track:errors.disabled");
    expect(sourcesErrorKey(new Error("offline"))).toBe("track:errors.network");
  });

  it("no new token while TravTrack is off or not the provider; revoking stays", async () => {
    vi.spyOn(travTrackSourcesApi, "list").mockResolvedValue([PIXEL]);
    for (const c of [{ enabled: false }, { active: false }]) {
      caps.current = { ...caps.current, enabled: true, active: true, ...c };
      const { unmount } = show();
      expect(await screen.findByRole("button", { name: "track:sources.revoke" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "track:sources.create" })).toBeNull();
      unmount();
    }
  });

  it("an older server without the sources list shows no section", async () => {
    caps.current = { ...caps.current, sources: undefined };
    show();
    await screen.findByTestId("travtrack-summary");
    expect(screen.queryByText("track:sources.title")).toBeNull();
    expect(travTrackSourcesApi.list).not.toHaveBeenCalled();
  });
});
