import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GeocoderSettingsCard from "../GeocoderSettingsCard";
import { adminApi } from "../../../lib/api";
import { searchPlaces } from "../../../lib/api/geo";
import { logger } from "../../../lib/logger";

vi.mock("../../../lib/api", () => ({
  adminApi: {
    getInstanceSettings: vi.fn(),
    updateInstanceSettings: vi.fn(),
  },
}));

vi.mock("../../../lib/api/geo", () => ({
  searchPlaces: vi.fn(),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SETTINGS_FIXTURE = {
  instanceName: "TravStats",
  maxUsers: 10,
  allowRegistration: false,
  frontendUrl: null,
  publicUrl: null,
  lanUrl: null,
  webauthnRpId: null,
  webauthnOrigins: [],
  betaFeaturesEnabled: false,
  photonUrl: "https://photon.komoot.io",
  nominatimUrl: "https://nominatim.openstreetmap.org",
};

/** The endpoint answers with the settings PLUS a derived passkey status; this
 *  card cares about neither, so wrap once rather than repeat it per case. */
const resp = (settings: typeof SETTINGS_FIXTURE) => ({
  settings,
  passkeyStatus: { usable: false, reason: "notConfigured" },
});

describe("GeocoderSettingsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── THE GUARD (Immich near-miss) ──────────────────────────────────────
  // A failed GET must render an explicit error state with ZERO inputs and
  // ZERO way to save — never an empty form whose Save would send nulls and
  // silently clear the stored URLs.
  it("renders a load-error state with no inputs and no save button when the GET fails", async () => {
    vi.mocked(adminApi.getInstanceSettings).mockRejectedValue(new Error("network exploded"));

    render(<GeocoderSettingsCard isAdmin={true} />);

    await waitFor(() => expect(screen.getByTestId("geocoder-load-error")).toBeInTheDocument());

    expect(screen.queryByLabelText(/photonUrlLabel/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/settings:lodgingPreferences.geocoder.saveButton|common:buttons.save/)
    ).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalled();

    // No accidental save path exists at all — updateInstanceSettings must
    // never be reachable from this render.
    expect(adminApi.updateInstanceSettings).not.toHaveBeenCalled();
  });

  it("does not render anything for non-admins, and never calls the GET", () => {
    const { container } = render(<GeocoderSettingsCard isAdmin={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(adminApi.getInstanceSettings).not.toHaveBeenCalled();
  });

  it("loads and shows the resolved URLs once the GET succeeds", async () => {
    vi.mocked(adminApi.getInstanceSettings).mockResolvedValue(resp(SETTINGS_FIXTURE));

    render(<GeocoderSettingsCard isAdmin={true} />);

    const photonInput = await screen.findByLabelText(
      "settings:lodgingPreferences.geocoder.photonUrlLabel"
    );
    const nominatimInput = screen.getByLabelText(
      "settings:lodgingPreferences.geocoder.nominatimUrlLabel"
    );
    expect((photonInput as HTMLInputElement).value).toBe("https://photon.komoot.io");
    expect((nominatimInput as HTMLInputElement).value).toBe("https://nominatim.openstreetmap.org");
  });

  // ── Finding 1/2 (pinning the resolved default) ────────────────────────
  // GET always returns RESOLVED urls — never null — so on a fresh instance
  // the inputs are pre-filled with the literal default (photon.komoot.io).
  // Clicking Save without editing anything must NOT re-send that default
  // as an explicit DB override — doing so would permanently pin it and
  // silently swallow any future ENV/default change.
  it("does not pin the resolved defaults into the DB when Save is clicked without any edits", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getInstanceSettings).mockResolvedValue(resp(SETTINGS_FIXTURE));

    render(<GeocoderSettingsCard isAdmin={true} />);

    await screen.findByLabelText("settings:lodgingPreferences.geocoder.photonUrlLabel");

    await user.click(screen.getByText("common:buttons.save"));

    await waitFor(() =>
      expect(
        screen.getByText("settings:lodgingPreferences.geocoder.saveSuccess")
      ).toBeInTheDocument()
    );

    expect(adminApi.updateInstanceSettings).not.toHaveBeenCalled();
  });

  it("only sends the field that was actually edited (per-field dirty tracking)", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getInstanceSettings).mockResolvedValue(resp(SETTINGS_FIXTURE));
    vi.mocked(adminApi.updateInstanceSettings).mockResolvedValue(
      resp({ ...SETTINGS_FIXTURE, photonUrl: "https://photon.example.com" })
    );

    render(<GeocoderSettingsCard isAdmin={true} />);

    const photonInput = await screen.findByLabelText(
      "settings:lodgingPreferences.geocoder.photonUrlLabel"
    );

    await user.clear(photonInput);
    await user.type(photonInput, "https://photon.example.com");

    await user.click(screen.getByText("common:buttons.save"));

    await waitFor(() =>
      expect(adminApi.updateInstanceSettings).toHaveBeenCalledWith({
        photonUrl: "https://photon.example.com",
      })
    );
  });

  it("saves the entered URLs via PUT (roundtrip), including clearing to empty", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getInstanceSettings).mockResolvedValue(resp(SETTINGS_FIXTURE));
    vi.mocked(adminApi.updateInstanceSettings).mockResolvedValue(
      resp({ ...SETTINGS_FIXTURE, photonUrl: "https://photon.example.com", nominatimUrl: "" })
    );

    render(<GeocoderSettingsCard isAdmin={true} />);

    const photonInput = await screen.findByLabelText(
      "settings:lodgingPreferences.geocoder.photonUrlLabel"
    );
    const nominatimInput = screen.getByLabelText(
      "settings:lodgingPreferences.geocoder.nominatimUrlLabel"
    );

    await user.clear(photonInput);
    await user.type(photonInput, "https://photon.example.com");
    await user.clear(nominatimInput);

    await user.click(screen.getByText("common:buttons.save"));

    await waitFor(() =>
      expect(adminApi.updateInstanceSettings).toHaveBeenCalledWith({
        photonUrl: "https://photon.example.com",
        nominatimUrl: "",
      })
    );
  });

  it("shows the hit count when the connection test succeeds", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getInstanceSettings).mockResolvedValue(resp(SETTINGS_FIXTURE));
    vi.mocked(searchPlaces).mockResolvedValue({ results: [
      { name: "Berlin", lat: 52.52, lon: 13.405 },
      { name: "Berlin, Connecticut", lat: 41.62, lon: -72.75 },
    ], degraded: false });

    render(<GeocoderSettingsCard isAdmin={true} />);

    await screen.findByLabelText("settings:lodgingPreferences.geocoder.photonUrlLabel");
    await user.click(screen.getByText("settings:lodgingPreferences.geocoder.testButton"));

    await waitFor(() => expect(searchPlaces).toHaveBeenCalledWith("Berlin"));
    expect(
      await screen.findByText("settings:lodgingPreferences.geocoder.testSuccess")
    ).toBeInTheDocument();
  });

  // ── Finding 3 (empty result must not read as an error) ────────────────
  // Zero hits is still a SUCCESSFUL connection ("Verbindung erfolgreich,
  // aber keine Treffer") — it must render in the same neutral/success
  // color as a hit, not the red used for an actual connection failure.
  it("shows the empty-result message in a non-error color when the test succeeds with zero hits", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getInstanceSettings).mockResolvedValue(resp(SETTINGS_FIXTURE));
    vi.mocked(searchPlaces).mockResolvedValue({ results: [], degraded: false });

    render(<GeocoderSettingsCard isAdmin={true} />);

    await screen.findByLabelText("settings:lodgingPreferences.geocoder.photonUrlLabel");
    await user.click(screen.getByText("settings:lodgingPreferences.geocoder.testButton"));

    const message = await screen.findByText("settings:lodgingPreferences.geocoder.testEmpty");
    expect(message).toHaveStyle({ color: "var(--success)" });
  });

  it("shows a translated failure message (and logs) when the connection test fails", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getInstanceSettings).mockResolvedValue(resp(SETTINGS_FIXTURE));
    vi.mocked(searchPlaces).mockRejectedValue(new Error("geocoder is down"));

    render(<GeocoderSettingsCard isAdmin={true} />);

    await screen.findByLabelText("settings:lodgingPreferences.geocoder.photonUrlLabel");
    await user.click(screen.getByText("settings:lodgingPreferences.geocoder.testButton"));

    expect(
      await screen.findByText("settings:lodgingPreferences.geocoder.testError")
    ).toBeInTheDocument();
    expect(logger.error).toHaveBeenCalled();
  });
});
