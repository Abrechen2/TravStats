import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreateLinkInviteModal from "../../../components/Admin/CreateLinkInviteModal";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

describe("CreateLinkInviteModal", () => {
  const onCreate = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders three expiration radio options", () => {
    render(<CreateLinkInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    expect(screen.getByLabelText(/expires\.24h/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expires\.7d/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expires\.30d/i)).toBeInTheDocument();
  });

  it("calls onCreate with 7 by default", async () => {
    onCreate.mockResolvedValue(undefined);
    render(<CreateLinkInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.click(screen.getByRole("button", { name: /createLinkModal\.submit/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(7));
  });

  it("calls onCreate with 30 when the user picks 30 days", async () => {
    onCreate.mockResolvedValue(undefined);
    render(<CreateLinkInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.click(screen.getByLabelText(/expires\.30d/i));
    fireEvent.click(screen.getByRole("button", { name: /createLinkModal\.submit/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(30));
  });

  it("disables the submit button while creating is true", () => {
    render(<CreateLinkInviteModal onCreate={onCreate} onClose={onClose} creating={true} />);
    expect(screen.getByRole("button", { name: /createLinkModal\.submit/i })).toBeDisabled();
  });
});
