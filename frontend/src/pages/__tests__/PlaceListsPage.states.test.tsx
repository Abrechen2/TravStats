import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The lists overview's states (forgejo#247, #250): a failed load is not "no
 * lists", the empty section offers the first list, and a refused subscription
 * stays on the page instead of vanishing as a toast.
 */
const listPlaceLists = vi.fn();
const listCuratedChecklists = vi.fn();
const subscribeChecklist = vi.fn();

vi.mock("../../lib/api/placeLists", () => ({
  listPlaceLists: (...a: unknown[]) => listPlaceLists(...a),
  listCuratedChecklists: (...a: unknown[]) => listCuratedChecklists(...a),
  subscribeChecklist: (...a: unknown[]) => subscribeChecklist(...a),
  createPlaceList: vi.fn(),
}));
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});
vi.mock("../../hooks/usePlacesVisible", () => ({ usePlacesAccess: () => "allowed" }));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/places/PlaceListLabelFields", () => ({
  PlaceListLabelFields: () => null,
  hasSymbol: (v: string) => v.trim().length > 0,
}));

import PlaceListsPage from "../PlaceListsPage";

const CHECKLIST = {
  key: "new7",
  name: "Neue Weltwunder",
  nameDe: "Neue Weltwunder",
  nameEn: "New7Wonders",
  description: null,
  itemCount: 7,
  tickedCount: 0,
  subscribed: false,
  domain: "poi",
};

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <PlaceListsPage />
    </MemoryRouter>
  );
  await act(async () => {});
}

describe("PlaceListsPage — states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPlaceLists.mockResolvedValue([]);
    listCuratedChecklists.mockResolvedValue([CHECKLIST]);
  });

  it("tells a failed load apart and reads again on retry", async () => {
    listPlaceLists
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
      .mockResolvedValueOnce([]);
    await renderPage();
    expect(screen.getByText("Die Listen konnten nicht geladen werden.")).toBeInTheDocument();
    expect(screen.getByText("HTTP 503")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(listPlaceLists).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Erste Liste anlegen" })).toBeInTheDocument();
  });

  it("offers the first list where there is none, in a dialog", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Erste Liste anlegen" }));
    expect(screen.getByRole("dialog", { name: "Neue Liste" })).toBeInTheDocument();
  });

  it("keeps a refused subscription on the page", async () => {
    subscribeChecklist.mockRejectedValue({ isAxiosError: true, message: "Network Error" });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Folgen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Der Server ist nicht erreichbar");
  });
});
