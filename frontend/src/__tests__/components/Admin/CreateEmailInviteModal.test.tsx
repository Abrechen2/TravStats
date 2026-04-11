import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreateEmailInviteModal from "../../../components/Admin/CreateEmailInviteModal";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

describe("CreateEmailInviteModal", () => {
  const onCreate = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks submit when email is empty", async () => {
    render(<CreateEmailInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.click(screen.getByRole("button", { name: /createEmailModal\.submit/i }));
    await waitFor(() => {
      expect(screen.getByText(/createEmailModal\.emailRequired/i)).toBeInTheDocument();
    });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("blocks submit when email is invalid", async () => {
    render(<CreateEmailInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.change(screen.getByLabelText(/createEmailModal\.emailLabel/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /createEmailModal\.submit/i }));
    await waitFor(() => {
      expect(screen.getByText(/createEmailModal\.emailInvalid/i)).toBeInTheDocument();
    });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("calls onCreate with (email, 7) on valid input", async () => {
    onCreate.mockResolvedValue(undefined);
    render(<CreateEmailInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.change(screen.getByLabelText(/createEmailModal\.emailLabel/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /createEmailModal\.submit/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("jane@example.com", 7));
  });
});
