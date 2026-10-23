import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AxiosError } from "axios";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FederationSettings from "../FederationSettings";
import {
  federationAdminApi,
  type ConnectionFileInspection,
  type FederationState,
} from "../../../lib/api/federationAdmin";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/export", () => ({ downloadBlob: vi.fn() }));
vi.mock("../../../lib/api/federationAdmin", async (original) => ({
  ...(await original<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: {
    get: vi.fn(),
    update: vi.fn(),
    generateKey: vi.fn(),
    pinPeer: vi.fn(),
    verifyPeer: vi.fn(),
    suspendPeer: vi.fn(),
    downloadConnectionFile: vi.fn(),
    inspectConnectionFile: vi.fn(),
  },
}));

const { downloadBlob } = await import("../../../lib/export");

const noKey: FederationState = {
  source: null,
  enabled: true,
  origin: "https://me.example",
  publicKey: null,
  fingerprint: null,
  hasKey: false,
  tripSharingEnabled: false,
  peers: [],
};
const withKey: FederationState = {
  ...noKey,
  source: "settings",
  publicKey: "-----BEGIN PUBLIC KEY-----\nOWN\n-----END PUBLIC KEY-----\n",
  fingerprint: "ab".repeat(32),
  hasKey: true,
};
const inspection: ConnectionFileInspection = {
  origin: "https://friend.example",
  publicKey: "-----BEGIN PUBLIC KEY-----\nFRIEND\n-----END PUBLIC KEY-----\n",
  fingerprint: "12".repeat(32),
  existingPeer: null,
};

function refusal(status: number, code: string): AxiosError {
  const error = new AxiosError("refused");
  error.response = {
    status,
    data: { error: "prose", code },
    statusText: "",
    headers: {},
    config: { headers: {} } as never,
  };
  return error;
}

/** Picks a file and lets the inspect call, and the busy flag after it, settle inside act. */
const chooseFile = async (): Promise<void> => {
  const input = await screen.findByTestId("connection-file-input");
  await act(async () => {
    fireEvent.change(input, {
      target: { files: [new File(["zip"], "travstats-verbindung-friend.zip")] },
    });
  });
};

describe("FederationSettings: replacing the key", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates a first key without asking", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(noKey);
    vi.mocked(federationAdminApi.generateKey).mockResolvedValue(withKey);
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.generateKey" }));
    await waitFor(() => expect(federationAdminApi.generateKey).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("federation.rotateConfirm.title")).toBeNull();
    expect(screen.queryByText("federation.rotatedHint")).toBeNull();
  });

  it("asks before replacing an existing key, and cancel changes nothing", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.generateKey" }));
    expect(await screen.findByText("federation.rotateConfirm.title")).toBeInTheDocument();
    expect(screen.getByText("federation.rotateConfirm.message")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    await waitFor(() => expect(screen.queryByText("federation.rotateConfirm.title")).toBeNull());
    expect(federationAdminApi.generateKey).not.toHaveBeenCalled();
  });

  it("asks too while federation is off and no fingerprint is shown, but a key is stored", async () => {
    // loadIdentity refuses with federation disabled, so the fingerprint is null — the stored
    // key is still there, and replacing it must not pass without the question.
    vi.mocked(federationAdminApi.get).mockResolvedValue({
      ...noKey,
      enabled: false,
      source: null,
      hasKey: true,
    });
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.generateKey" }));
    expect(await screen.findByText("federation.rotateConfirm.title")).toBeInTheDocument();
    expect(federationAdminApi.generateKey).not.toHaveBeenCalled();
  });

  it("replaces the key on confirm and asks to send the new file on", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    vi.mocked(federationAdminApi.generateKey).mockResolvedValue({
      ...withKey,
      fingerprint: "cd".repeat(32),
    });
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.generateKey" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "federation.rotateConfirm.confirm" })
    );
    expect(await screen.findByText("federation.rotatedHint")).toBeInTheDocument();
    expect(federationAdminApi.generateKey).toHaveBeenCalledTimes(1);
  });
});

describe("FederationSettings: own identity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the fingerprint in view and the PEM text in a closed section", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    render(<FederationSettings />);
    expect(await screen.findByText("ab".repeat(32))).toBeVisible();
    const pem = screen.getByText(/OWN/);
    expect(pem.closest("details")).not.toHaveAttribute("open");
  });

  it("downloads the connection file under the server's own name", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    const blob = new Blob(["zip"]);
    vi.mocked(federationAdminApi.downloadConnectionFile).mockResolvedValue({
      blob,
      filename: "travstats-verbindung-me.example.zip",
    });
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.downloadFile" }));
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(blob, "travstats-verbindung-me.example.zip")
    );
  });

  it("offers no download without a key, and holds it while the address is being changed", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValueOnce(noKey).mockResolvedValue(withKey);
    const { unmount } = render(<FederationSettings />);
    await screen.findByRole("button", { name: "federation.generateKey" });
    expect(screen.queryByRole("button", { name: "federation.downloadFile" })).toBeNull();
    unmount();

    render(<FederationSettings />);
    const button = await screen.findByRole("button", { name: "federation.downloadFile" });
    expect(button).toBeEnabled();
    fireEvent.change(screen.getByLabelText("federation.origin"), {
      target: { value: "https://new.example" },
    });
    expect(button).toBeDisabled();
    expect(screen.getByText("federation.downloadOriginPending")).toBeInTheDocument();
  });

  it("offers the download under an env-held identity too", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue({ ...withKey, source: "env" });
    render(<FederationSettings />);
    expect(await screen.findByRole("button", { name: "federation.downloadFile" })).toBeEnabled();
  });

  it("names a refused download", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    vi.mocked(federationAdminApi.downloadConnectionFile).mockRejectedValue(
      refusal(409, "COMPARISON_FEDERATION_OFF")
    );
    render(<FederationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "federation.downloadFile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "federation.error.COMPARISON_FEDERATION_OFF"
    );
  });
});

describe("FederationSettings: importing a connection file", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the manual fields in a closed section until something fills them", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    render(<FederationSettings />);
    const field = await screen.findByLabelText("federation.peerOrigin");
    expect(field.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("federation.manualEntry")).toBeInTheDocument();
  });

  it("prefills the form as not yet checked, and pins exactly the reviewed values", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    vi.mocked(federationAdminApi.inspectConnectionFile).mockResolvedValue(inspection);
    vi.mocked(federationAdminApi.pinPeer).mockResolvedValue(withKey);
    render(<FederationSettings />);
    await chooseFile();
    const review = await screen.findByTestId("connection-file-review");
    expect(review).toHaveTextContent("federation.importedStatus");
    expect(review).toHaveTextContent("https://friend.example");
    expect(review).toHaveTextContent("12".repeat(32));
    expect(review).toHaveTextContent("federation.importedCompare");
    expect(federationAdminApi.pinPeer).not.toHaveBeenCalled();
    const origin = screen.getByLabelText("federation.peerOrigin");
    expect(origin.closest("details")).toHaveAttribute("open");
    expect(origin).toHaveValue("https://friend.example");
    expect(screen.getByLabelText("federation.peerKey")).toHaveValue(inspection.publicKey);

    fireEvent.click(screen.getByRole("button", { name: "federation.pin" }));
    await waitFor(() =>
      expect(federationAdminApi.pinPeer).toHaveBeenCalledWith({
        origin: inspection.origin,
        publicKey: inspection.publicKey,
        fingerprint: inspection.fingerprint,
        enabled: true,
      })
    );
    await waitFor(() => expect(screen.queryByTestId("connection-file-review")).toBeNull());
  });

  it("drops the import as soon as a field is edited", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    vi.mocked(federationAdminApi.inspectConnectionFile).mockResolvedValue(inspection);
    render(<FederationSettings />);
    await chooseFile();
    await screen.findByTestId("connection-file-review");
    fireEvent.change(screen.getByLabelText("federation.peerFingerprint"), {
      target: { value: "34".repeat(32) },
    });
    expect(screen.queryByTestId("connection-file-review")).toBeNull();
    expect(screen.queryByText("federation.importedStatus")).toBeNull();
  });

  it("warns that a known server's key is being replaced", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    vi.mocked(federationAdminApi.inspectConnectionFile).mockResolvedValue({
      ...inspection,
      existingPeer: { fingerprint: "99".repeat(32), sameKey: false },
    });
    render(<FederationSettings />);
    await chooseFile();
    expect(await screen.findByText("federation.importedReplaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "federation.pin" })).toBeEnabled();
  });

  it("says a server with the same key is already stored and offers no pin", async () => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    vi.mocked(federationAdminApi.inspectConnectionFile).mockResolvedValue({
      ...inspection,
      existingPeer: { fingerprint: inspection.fingerprint, sameKey: true },
    });
    render(<FederationSettings />);
    await chooseFile();
    expect(await screen.findByText("federation.importedAlreadyStored")).toBeInTheDocument();
    expect(screen.queryByText("federation.importedReplaces")).toBeNull();
    expect(screen.getByRole("button", { name: "federation.pin" })).toBeDisabled();
  });

  it.each([
    "COMPARISON_CONNECTION_FILE_UNREADABLE",
    "COMPARISON_CONNECTION_FILE_TOO_LARGE",
    "COMPARISON_CONNECTION_FILE_FORMAT",
    "COMPARISON_CONNECTION_FILE_ORIGIN",
    "COMPARISON_CONNECTION_FILE_KEY",
    "COMPARISON_CONNECTION_FILE_FINGERPRINT",
    "COMPARISON_CONNECTION_FILE_SELF",
  ])("names the refusal %s in its own sentence", async (code) => {
    vi.mocked(federationAdminApi.get).mockResolvedValue(withKey);
    vi.mocked(federationAdminApi.inspectConnectionFile).mockRejectedValue(refusal(422, code));
    render(<FederationSettings />);
    await chooseFile();
    expect(await screen.findByRole("alert")).toHaveTextContent(`federation.error.${code}`);
    expect(screen.queryByTestId("connection-file-review")).toBeNull();
  });
});
