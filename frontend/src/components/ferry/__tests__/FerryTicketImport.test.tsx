import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FerryTicketImport } from "../FerryTicketImport";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), upload: vi.fn(), t: (s: string) => s }));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/ferry", () => ({ ferryApi: { ticketPreview: mocks.preview } }));
vi.mock("../../../lib/api/client", () => ({ api: { post: mocks.upload } }));
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Ferry ticket review", () => {
  it("shows evidence, leaves filled fields unselected and applies only the chosen values", async () => {
    mocks.preview.mockResolvedValue({
      crossings: [
        {
          price: { value: "240", evidence: "240 EUR" },
          currency: { value: "EUR", evidence: "240 EUR" },
          operator: { value: "Adria", evidence: "Adria" },
        },
      ],
      parser: "labels",
      reason: null,
      provider: null,
    });
    const apply = vi.fn();
    render(
      <FerryTicketImport
        current={{ operator: "Existing", price: "", currency: "EUR" }}
        onApply={apply}
        onBusyChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("ferry:import.title"));
    fireEvent.change(screen.getByLabelText("ferry:import.text"), {
      target: { value: "Ferry ticket text for this crossing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ferry:import.read" }));
    await screen.findByText("ferry:import.review");
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("checkbox")).toBeChecked();
    expect(within(rows[1]).getByRole("checkbox")).toBeChecked();
    expect(within(rows[2]).getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "ferry:import.apply" }));
    expect(apply).toHaveBeenCalledWith({ price: "240", currency: "EUR" }, null);
  });
  it("keeps an uploaded document on parse failure and reuses it on retry", async () => {
    mocks.upload.mockResolvedValue({ data: { data: { id: "owned-doc" } } });
    mocks.preview
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ crossings: [], parser: null, reason: "noText", provider: null });
    render(<FerryTicketImport current={{}} onApply={vi.fn()} onBusyChange={vi.fn()} />);
    fireEvent.click(screen.getByText("ferry:import.title"));
    fireEvent.change(screen.getByLabelText("ferry:import.file"), {
      target: { files: [new File(["%PDF-test"], "ticket.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "ferry:import.read" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "ferry:import.read" }));
    await screen.findByText("ferry:import.noText");
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.preview).toHaveBeenLastCalledWith({ documentId: "owned-doc" });
  });
  it("requires an explicit action before any parse or upload", () => {
    render(<FerryTicketImport current={{}} onApply={vi.fn()} onBusyChange={vi.fn()} />);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
