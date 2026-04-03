import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import MyTemplates from "../../../components/Parser/MyTemplates";
import * as api from "../../../lib/api";

vi.mock("../../../lib/api", () => ({
  parserTemplatesApi: {
    list: vi.fn(),
    setStatus: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const mockTemplates = [
  {
    id: "t1",
    name: "Lufthansa DE",
    status: "active" as const,
    createdAt: "2026-04-01T10:00:00Z",
    updatedAt: "2026-04-01T10:00:00Z",
    stats: { matchCount: 12, successRate: 0.92, lastUsedAt: "2026-04-02T08:00:00Z" },
  },
  {
    id: "t2",
    name: "Ryanair EN",
    status: "disabled" as const,
    createdAt: "2026-03-28T12:00:00Z",
    updatedAt: "2026-03-28T12:00:00Z",
  },
];

describe("MyTemplates", () => {
  beforeEach(() => {
    vi.mocked(api.parserTemplatesApi.list).mockResolvedValue(mockTemplates);
    vi.mocked(api.parserTemplatesApi.setStatus).mockResolvedValue(undefined);
    vi.mocked(api.parserTemplatesApi.delete).mockResolvedValue(undefined);
  });

  it("zeigt Templates nach Laden", async () => {
    render(<MyTemplates />);
    await waitFor(() => expect(screen.getByText("Lufthansa DE")).toBeInTheDocument());
    expect(screen.getByText("Ryanair EN")).toBeInTheDocument();
  });

  it("zeigt Empty-State wenn keine Templates", async () => {
    vi.mocked(api.parserTemplatesApi.list).mockResolvedValue([]);
    render(<MyTemplates />);
    await waitFor(() => expect(screen.getByText("parser:myTemplates.empty")).toBeInTheDocument());
  });

  it("aktiviert ein disabled Template", async () => {
    render(<MyTemplates />);
    await waitFor(() => screen.getByText("Ryanair EN"));
    fireEvent.click(screen.getByTestId("activate-t2"));
    await waitFor(() =>
      expect(api.parserTemplatesApi.setStatus).toHaveBeenCalledWith("t2", "active")
    );
  });

  it("deaktiviert ein aktives Template", async () => {
    render(<MyTemplates />);
    await waitFor(() => screen.getByText("Lufthansa DE"));
    fireEvent.click(screen.getByTestId("disable-t1"));
    await waitFor(() =>
      expect(api.parserTemplatesApi.setStatus).toHaveBeenCalledWith("t1", "disabled")
    );
  });

  it("löscht ein Template nach Bestätigung", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MyTemplates />);
    await waitFor(() => screen.getByText("Lufthansa DE"));
    fireEvent.click(screen.getAllByText("common:buttons.delete")[0]);
    await waitFor(() => expect(api.parserTemplatesApi.delete).toHaveBeenCalledWith("t1"));
  });
});
