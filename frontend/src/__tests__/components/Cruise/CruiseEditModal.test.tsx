import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseEditModal } from "../../../components/Cruise/CruiseEditModal";
import { cruiseApi } from "../../../lib/api";
import type { Cruise } from "../../../types";

vi.mock("../../../lib/api", () => ({
  cruiseApi: { create: vi.fn(), update: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  shipsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    ready: true,
  }),
}));

describe("CruiseEditModal", () => {
  // Create mode now opens on the chooser step so users can pick email-parser
  // or manual entry. Tests have to advance past it before they can interact
  // with the form. See commit 7811f55 for the refactor.
  const enterManualStep = async (): Promise<void> => {
    await userEvent.click(screen.getByRole("button", { name: /chooser\.manual\.cta/i }));
  };

  it("submits a new cruise and calls onSaved", async () => {
    vi.mocked(cruiseApi.create).mockResolvedValue({
      id: "c1",
      stops: [],
      tags: [],
      companions: [],
    } as unknown as Cruise);
    const onSaved = vi.fn();

    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={onSaved} />);
    await enterManualStep();

    const lineInput = screen.getByLabelText("field.line");
    await userEvent.type(lineInput, "AIDA");

    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    await waitFor(() => expect(cruiseApi.create).toHaveBeenCalled());
    const payload = vi.mocked(cruiseApi.create).mock.calls[0][0];
    expect(payload.cruiseLine).toBe("AIDA");
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows validation errors from server", async () => {
    vi.mocked(cruiseApi.create).mockRejectedValue({
      response: { data: { error: "Invalid payload" } },
    });

    render(<CruiseEditModal mode="create" onClose={vi.fn()} onSaved={vi.fn()} />);
    await enterManualStep();
    await userEvent.click(screen.getByRole("button", { name: /form\.save/i }));

    expect(await screen.findByText(/invalid payload/i)).toBeInTheDocument();
  });
});
