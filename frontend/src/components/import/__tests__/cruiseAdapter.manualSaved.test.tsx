/**
 * forgejo#247 end to end for cruises: the real panel, the real cruise adapter,
 * the real cruise form. A cruise that was stored but whose list failed to
 * reload must say so inside the form — and the open form must not create it
 * twice.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DomainImportPanel from "../DomainImportPanel";
import { useCruiseImportAdapter } from "../adapters/cruiseAdapter";
import { getNamed, queryNamed } from "../../../__tests__/helpers/namedElement";

const create = vi.fn();
vi.mock("../../../lib/api", () => ({
  cruiseApi: { create: (...a: unknown[]) => create(...a), update: vi.fn() },
  portsApi: { search: () => Promise.resolve([]), create: vi.fn() },
  shipsApi: {
    search: () => Promise.resolve([]),
    create: vi.fn(),
    cruiseLines: () => Promise.resolve([]),
  },
  companionsApi: { list: () => Promise.resolve([]) },
  tripsApi: { getAll: () => Promise.resolve([]) },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
vi.mock("../EmailImportTab", () => ({ default: () => null }));

function Host({ reload }: { reload: () => Promise<void> }): React.JSX.Element {
  const adapter = useCruiseImportAdapter();
  return <DomainImportPanel open onClose={vi.fn()} onItemsCreated={reload} adapter={adapter} />;
}

describe("cruise add flow — a failed reload after the create", () => {
  it("keeps the form open with the saved-but-not-refreshed notice and creates once", async () => {
    create.mockResolvedValue({ id: "new", stops: [], tags: [], companions: [] });
    const reload = vi.fn().mockRejectedValue(new Error("list unavailable"));
    render(<Host reload={reload} />);

    fireEvent.click(getNamed("button", "import:route.manual"));
    fireEvent.change(await screen.findByLabelText("field.routeName"), {
      target: { value: "Nordland" },
    });
    fireEvent.change(screen.getByLabelText(/^field\.startDate/), {
      target: { value: "2026-07-01" },
    });
    fireEvent.click(getNamed("button", "form.save"));

    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(queryNamed("button", "form.save")).toBeNull());
  });
});
