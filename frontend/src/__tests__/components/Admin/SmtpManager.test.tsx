/**
 * Issue #255: saved SMTP credentials could not be removed. The delete path
 * only exists where something is actually stored, and it must clear the form
 * as well as the server — a form still showing host and username after a
 * successful delete reads as if the delete failed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SmtpManager from "../../../components/Admin/SmtpManager";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

const getSmtpConfig = vi.fn();
const deleteSmtpConfig = vi.fn();
const saveSmtpConfig = vi.fn();
const testSmtpConnection = vi.fn();

vi.mock("../../../lib/api", () => ({
  adminApi: {
    getSmtpConfig: (...args: unknown[]) => getSmtpConfig(...args),
    deleteSmtpConfig: (...args: unknown[]) => deleteSmtpConfig(...args),
    saveSmtpConfig: (...args: unknown[]) => saveSmtpConfig(...args),
    testSmtpConnection: (...args: unknown[]) => testSmtpConnection(...args),
  },
}));

const addToast = vi.fn();
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}));

const CONFIGURED = {
  configured: true,
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "postmaster@example.com",
  password: "***",
  fromEmail: "noreply@example.com",
  fromName: "TravStats",
  enabled: true,
};

const DELETE_BUTTON = "settings:notifications.smtpDelete";
const CONFIRM_BUTTON = "settings:notifications.smtpDeleteConfirm.confirm";

describe("SmtpManager — deleting the credentials (#255)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteSmtpConfig.mockResolvedValue({ configured: false, deleted: true });
  });

  it("offers no delete on an instance that has no configuration", async () => {
    getSmtpConfig.mockResolvedValue({ configured: false });
    render(<SmtpManager />);

    await screen.findByDisplayValue("TravStats");
    expect(screen.queryByRole("button", { name: DELETE_BUTTON })).not.toBeInTheDocument();
  });

  it("deletes on confirmation and empties the form", async () => {
    const user = userEvent.setup();
    getSmtpConfig.mockResolvedValue(CONFIGURED);
    render(<SmtpManager />);

    await user.click(await screen.findByRole("button", { name: DELETE_BUTTON }));
    await user.click(await screen.findByRole("button", { name: CONFIRM_BUTTON }));

    await waitFor(() => expect(deleteSmtpConfig).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("smtp.example.com")).not.toBeInTheDocument()
    );
    expect(screen.queryByDisplayValue("postmaster@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DELETE_BUTTON })).not.toBeInTheDocument();
    expect(addToast).toHaveBeenCalledWith("success", "settings:notifications.smtpDeleted");
  });

  it("keeps everything when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    getSmtpConfig.mockResolvedValue(CONFIGURED);
    render(<SmtpManager />);

    await user.click(await screen.findByRole("button", { name: DELETE_BUTTON }));
    await user.click(await screen.findByRole("button", { name: "common:buttons.cancel" }));

    expect(deleteSmtpConfig).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("smtp.example.com")).toBeInTheDocument();
  });

  it("keeps the form and says so when the delete fails", async () => {
    const user = userEvent.setup();
    getSmtpConfig.mockResolvedValue(CONFIGURED);
    deleteSmtpConfig.mockRejectedValue(new Error("boom"));
    render(<SmtpManager />);

    await user.click(await screen.findByRole("button", { name: DELETE_BUTTON }));
    await user.click(await screen.findByRole("button", { name: CONFIRM_BUTTON }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("error", "boom"));
    expect(screen.getByDisplayValue("smtp.example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: DELETE_BUTTON })).toBeInTheDocument();
  });
});

// forgejo#249: no label named its field, and the help sat inside the label,
// where its button would have been read into the field's name.
describe("SmtpManager — every field is named by its label", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names each field by its label alone, with the help beside it", async () => {
    getSmtpConfig.mockResolvedValue(CONFIGURED);
    render(<SmtpManager />);
    for (const key of ["Host", "Username", "FromEmail", "FromName"]) {
      expect(
        await screen.findByRole("textbox", { name: `settings:notifications.smtp${key}` })
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("spinbutton", { name: "settings:notifications.smtpPort" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("settings:notifications.smtpPassword")).toHaveAttribute(
      "type",
      "password"
    );

    await userEvent.click(screen.getAllByRole("button", { name: "help.about" })[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent("settings:notifications.smtpHelp.ports");
  });
});
