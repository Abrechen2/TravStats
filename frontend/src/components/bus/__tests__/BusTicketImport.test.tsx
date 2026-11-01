import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusTicketImport } from "../BusTicketImport";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), upload: vi.fn(), t: (s: string) => s }));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/bus", () => ({ busApi: { ticketPreview: mocks.preview } }));
vi.mock("../../../lib/api/client", () => ({ api: { post: mocks.upload } }));

beforeEach(() => vi.clearAllMocks());

const open = (): void => {
  fireEvent.click(screen.getByText("bus:import.title"));
  fireEvent.change(screen.getByLabelText("bus:import.text"), {
    target: { value: "Synthetic coach ticket text" },
  });
  fireEvent.click(screen.getByRole("button", { name: "bus:import.read" }));
};

/** forgejo#309: a coach ticket read by a bus template, reviewed before it reaches the form. */
describe("BusTicketImport", () => {
  it("says which template read it, leaves filled fields unselected and applies the chosen values", async () => {
    mocks.preview.mockResolvedValue({
      rides: [
        {
          departureStop: { value: "Probestadt ZOB", evidence: "Probestadt ZOB" },
          departureLocal: { value: "2028-03-02T07:30", evidence: "2028-03-02T07:30" },
          operator: { value: "Fernbus Probeland", evidence: "Fernbus Probeland" },
        },
      ],
      parser: "template",
      reason: null,
      template: { id: "bus:user-1", source: "workshop" },
    });
    const apply = vi.fn();
    render(
      <MemoryRouter>
        <BusTicketImport current={{ operator: "Typed" }} onApply={apply} onBusyChange={vi.fn()} />
      </MemoryRouter>
    );
    open();
    await screen.findByText("bus:import.readByWorkshop");
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("checkbox")).toBeChecked();
    expect(within(rows[1]).getByRole("checkbox")).toBeChecked();
    expect(within(rows[2]).getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "bus:import.apply" }));
    expect(apply).toHaveBeenCalledWith({
      departureStop: "Probestadt ZOB",
      departureLocal: "2028-03-02T07:30",
    });
  });

  it.each([
    ["noTemplate", "bus:import.noTemplate"],
    ["nothingRead", "bus:import.nothingRead"],
    ["noText", "bus:import.noText"],
  ])("says why nothing was read (%s), never an empty review", async (reason, copy) => {
    mocks.preview.mockResolvedValue({ rides: [], parser: null, reason, template: null });
    render(
      <MemoryRouter>
        <BusTicketImport current={{}} onApply={vi.fn()} onBusyChange={vi.fn()} />
      </MemoryRouter>
    );
    open();
    expect(await screen.findByRole("status")).toHaveTextContent(copy);
    expect(screen.queryByRole("button", { name: "bus:import.apply" })).toBeNull();
  });

  it("reports a failed request as a failure", async () => {
    mocks.preview.mockRejectedValue(new Error("offline"));
    render(
      <MemoryRouter>
        <BusTicketImport current={{}} onApply={vi.fn()} onBusyChange={vi.fn()} />
      </MemoryRouter>
    );
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("bus:import.error");
  });
});

/** forgejo#330: "this ticket was not recognised" is one click from the workshop, document in hand. */
describe("BusTicketImport: the way to the workshop", () => {
  it("offers a workshop link when no template read the ticket", async () => {
    mocks.preview.mockResolvedValue({
      rides: [],
      parser: null,
      reason: "noTemplate",
      template: null,
    });
    render(
      <MemoryRouter>
        <BusTicketImport current={{}} onApply={vi.fn()} onBusyChange={vi.fn()} />
      </MemoryRouter>
    );
    open();
    expect(await screen.findByRole("button", { name: "parser:handoff.link" })).toBeInTheDocument();
  });

  it("offers none when the ticket had no text at all - a workshop cannot learn from nothing", async () => {
    mocks.preview.mockResolvedValue({ rides: [], parser: null, reason: "noText", template: null });
    render(
      <MemoryRouter>
        <BusTicketImport current={{}} onApply={vi.fn()} onBusyChange={vi.fn()} />
      </MemoryRouter>
    );
    open();
    await screen.findByRole("status");
    expect(screen.queryByRole("button", { name: "parser:handoff.link" })).toBeNull();
  });
});
