import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import InstanceSettings from "../../../components/Admin/InstanceSettings";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

const getInstanceSettings = vi.hoisted(() => vi.fn());
const updateInstanceSettings = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api", () => ({
  adminApi: {
    getInstanceSettings: (...a: unknown[]) => getInstanceSettings(...a),
    updateInstanceSettings: (...a: unknown[]) => updateInstanceSettings(...a),
  },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

const base = {
  instanceName: "TravStats",
  maxUsers: 10,
  allowRegistration: false,
  frontendUrl: null,
  publicUrl: null,
  lanUrl: null,
  webauthnRpId: null as string | null,
  webauthnOrigins: [] as string[],
};

describe("InstanceSettings — passkey relying party", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInstanceSettings.mockResolvedValue({
      settings: base,
      passkeyStatus: { usable: false, reason: "notConfigured" },
    });
  });

  it("reports the status the SERVER computed, not one the browser guessed", async () => {
    getInstanceSettings.mockResolvedValue({
      settings: { ...base, webauthnOrigins: ["http://192.168.1.5:3010"] },
      passkeyStatus: { usable: false, reason: "insecureOrigin" },
    });
    render(<InstanceSettings />);

    await waitFor(() =>
      expect(screen.getByText("admin:instance.passkeys.status.insecureOrigin")).toBeInTheDocument()
    );
  });

  it("says so when passkeys are usable", async () => {
    getInstanceSettings.mockResolvedValue({
      settings: { ...base, webauthnRpId: "trav.example.com", webauthnOrigins: ["https://trav.example.com"] },
      passkeyStatus: { usable: true, reason: null },
    });
    render(<InstanceSettings />);

    await waitFor(() =>
      expect(screen.getByText("admin:instance.passkeys.statusUsable")).toBeInTheDocument()
    );
  });

  it("shows stored origins one per line", async () => {
    getInstanceSettings.mockResolvedValue({
      settings: {
        ...base,
        webauthnOrigins: ["https://a.example.com", "https://b.example.com"],
      },
      passkeyStatus: { usable: true, reason: null },
    });
    render(<InstanceSettings />);

    const box = (await screen.findByLabelText(
      "admin:instance.passkeys.origins.label"
    )) as HTMLTextAreaElement;
    expect(box.value).toBe("https://a.example.com\nhttps://b.example.com");
  });

  // The textarea is a human editing surface; the API takes an array. Blank
  // lines are how people space things out while typing, not entries.
  it("sends the origins as an array and drops blank lines", async () => {
    updateInstanceSettings.mockResolvedValue({
      settings: { ...base, webauthnRpId: "trav.example.com", webauthnOrigins: ["https://trav.example.com"] },
      passkeyStatus: { usable: true, reason: null },
    });
    render(<InstanceSettings />);

    fireEvent.change(await screen.findByLabelText("admin:instance.passkeys.rpId.label"), {
      target: { value: "trav.example.com" },
    });
    fireEvent.change(screen.getByLabelText("admin:instance.passkeys.origins.label"), {
      target: { value: "https://trav.example.com\n\n  \nhttps://www.trav.example.com  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /buttons\.save/i }));

    await waitFor(() =>
      expect(updateInstanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          webauthnRpId: "trav.example.com",
          webauthnOrigins: ["https://trav.example.com", "https://www.trav.example.com"],
        })
      )
    );
  });

  // Eight fields on this form: a bare "save failed" makes the admin hunt.
  it("names the offending field when the server rejects a value", async () => {
    updateInstanceSettings.mockRejectedValue({
      response: {
        data: {
          error: "Validation error",
          details: [
            { field: "webauthnRpId", message: "Must be a bare domain — not a URL and not an IP" },
          ],
        },
      },
    });
    render(<InstanceSettings />);

    fireEvent.change(await screen.findByLabelText("admin:instance.passkeys.rpId.label"), {
      target: { value: "https://trav.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /buttons\.save/i }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "error",
        "webauthnRpId: Must be a bare domain — not a URL and not an IP"
      )
    );
  });

  it("falls back to the generic message when the failure is not a validation error", async () => {
    updateInstanceSettings.mockRejectedValue(new Error("network down"));
    render(<InstanceSettings />);

    fireEvent.change(await screen.findByLabelText("admin:instance.passkeys.rpId.label"), {
      target: { value: "trav.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /buttons\.save/i }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "admin:instance.saveFailed")
    );
  });

  it("refreshes the status from the save response", async () => {
    updateInstanceSettings.mockResolvedValue({
      settings: { ...base, webauthnRpId: "trav.example.com", webauthnOrigins: ["https://trav.example.com"] },
      passkeyStatus: { usable: true, reason: null },
    });
    render(<InstanceSettings />);

    await waitFor(() =>
      expect(
        screen.getByText("admin:instance.passkeys.status.notConfigured")
      ).toBeInTheDocument()
    );

    fireEvent.change(screen.getByLabelText("admin:instance.passkeys.origins.label"), {
      target: { value: "https://trav.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /buttons\.save/i }));

    await waitFor(() =>
      expect(screen.getByText("admin:instance.passkeys.statusUsable")).toBeInTheDocument()
    );
  });
});
