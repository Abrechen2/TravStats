import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MyTemplates from "./MyTemplates";

/**
 * forgejo#309: only an ACTIVE template of a kind the repository takes offers
 * "Export for the community" — a pending one has proven nothing yet, and a
 * flight or stay template is stored in a format the repository does not take.
 */
const { row } = vi.hoisted(() => ({
  row: (id: string, domain: string, status: string) => ({
    id,
    name: id,
    domain,
    status,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
  }),
}));

vi.mock("../../lib/api", () => ({
  parserTemplatesApi: {
    list: vi
      .fn()
      .mockResolvedValue([
        row("bus-active", "bus", "active"),
        row("bus-pending", "bus", "pending"),
        row("stay-active", "lodging", "active"),
      ]),
    communityExport: vi.fn(),
    preview: vi.fn(),
    setStatus: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: unknown }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../hooks/useMinLoadingState", () => ({
  useMinLoadingState: (loading: boolean) => loading,
}));

describe("the community export action", () => {
  it("is offered for an active v2 template only, and opens its panel", async () => {
    render(<MyTemplates />);
    const share = await screen.findByTestId("share-bus-active");
    expect(screen.queryByTestId("share-bus-pending")).toBeNull();
    expect(screen.queryByTestId("share-stay-active")).toBeNull();
    fireEvent.click(share);
    expect(screen.getByTestId("community-export-bus-active")).toBeInTheDocument();
  });
});
