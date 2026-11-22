/**
 * Smart lists: the suggestion on the place page answers the inbox row, a refused answer is said
 * (never a silent success), and the brand search names why it could not answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SmartSuggestion } from "../../../../lib/api/smartLists";

const accept = vi.fn();
const reject = vi.fn();
vi.mock("../../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: {
    accept: (...a: unknown[]) => accept(...a),
    reject: (...a: unknown[]) => reject(...a),
  },
}));
const listPlaceSuggestions = vi.fn();
const searchBrands = vi.fn();
const saveListRule = vi.fn();
vi.mock("../../../../lib/api/smartLists", async (orig) => ({
  ...(await orig<typeof import("../../../../lib/api/smartLists")>()),
  listPlaceSuggestions: (...a: unknown[]) => listPlaceSuggestions(...a),
  searchBrands: (...a: unknown[]) => searchBrands(...a),
  saveListRule: (...a: unknown[]) => saveListRule(...a),
}));
vi.mock("../../../../lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

import PlaceVisitSuggestions from "../PlaceVisitSuggestions";
import { BrandRuleDialog } from "../BrandRuleDialog";

const suggestion: SmartSuggestion = {
  id: "stay-1",
  placeId: "place-1",
  name: "McDonald's Irschenberg",
  startAt: "2026-11-22T11:40:00.000Z",
  endAt: "2026-11-22T12:05:00.000Z",
  startLocal: "2026-11-22T12:40",
  endLocal: "2026-11-22T13:05",
  zone: "Europe/Berlin",
  durationMinutes: 25,
  distanceM: 14,
  source: "travtrack",
  strength: "id",
  lists: [{ listId: "l1", listName: "Maccis" }],
  lat: 47.8,
  lon: 11.9,
};

const axiosError = (code: string) => ({ response: { status: 409, data: { code } } });

describe("PlaceVisitSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPlaceSuggestions.mockResolvedValue([suggestion]);
  });

  it("asks 'Warst du am … hier?' with source, dwell and distance, and confirming answers the inbox row", async () => {
    accept.mockResolvedValue(undefined);
    const answered = vi.fn();
    render(<PlaceVisitSuggestions placeId="place-1" onAnswered={answered} />);
    expect(await screen.findByText(/Warst du am .* um .* hier\?/)).toBeInTheDocument();
    expect(screen.getByText(/25 Min\. — erkannt durch TravTrack \(14 m\)/)).toBeInTheDocument();
    expect(screen.getByText("Passt zu Liste Maccis")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(answered).toHaveBeenCalled());
    expect(accept).toHaveBeenCalledWith(
      "stay-1",
      expect.objectContaining({ placeId: "place-1", startAt: { local: "2026-11-22T12:40" } })
    );
  });

  it("'War ich nicht' rejects the same row", async () => {
    reject.mockResolvedValue(undefined);
    render(<PlaceVisitSuggestions placeId="place-1" onAnswered={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "War ich nicht" }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith("stay-1"));
  });

  it("says why a refused answer failed instead of closing silently", async () => {
    accept.mockRejectedValue(axiosError("TRAVTRACK_DISABLED"));
    const answered = vi.fn();
    render(<PlaceVisitSuggestions placeId="place-1" onAnswered={answered} />);
    await userEvent.click(await screen.findByRole("button", { name: "Bestätigen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TravTrack ist auf dieser Instanz ausgeschaltet"
    );
    expect(answered).not.toHaveBeenCalled();
  });

  it("says so when the suggestions could not be read (not 'no suggestion')", async () => {
    listPlaceSuggestions.mockRejectedValue(new Error("down"));
    render(<PlaceVisitSuggestions placeId="place-1" onAnswered={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("konnten nicht geladen werden");
  });

  it("flags a brand-string-only match as weaker", async () => {
    listPlaceSuggestions.mockResolvedValue([{ ...suggestion, strength: "name" }]);
    render(<PlaceVisitSuggestions placeId="place-1" onAnswered={vi.fn()} />);
    expect(await screen.findByText(/schwächerer Treffer/)).toBeInTheDocument();
  });
});

describe("BrandRuleDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the reason when Wikidata could not be asked, and saves nothing without a chain", async () => {
    searchBrands.mockRejectedValue(axiosError("UPSTREAM_TIMEOUT"));
    render(<BrandRuleDialog listId="l1" rule={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Kette suchen"), "mcdon");
    expect(
      await screen.findByText(/Wikidata hat nicht rechtzeitig geantwortet/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });

  it("picks a chain from the search and saves the rule with the defaults (auto-accept off)", async () => {
    searchBrands.mockResolvedValue([
      { id: "Q38076", label: "McDonald's", description: "fast-food chain" },
    ]);
    saveListRule.mockResolvedValue({ listId: "l1" });
    const saved = vi.fn();
    render(<BrandRuleDialog listId="l1" rule={null} onClose={vi.fn()} onSaved={saved} />);
    await userEvent.type(screen.getByLabelText("Kette suchen"), "mcdon");
    await userEvent.click(await screen.findByRole("button", { name: /McDonald's/ }));
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(saveListRule).toHaveBeenCalledWith("l1", {
      brands: [{ brandWikidataId: "Q38076", brandName: "McDonald's" }],
      minDwellMinutes: 5,
      maxDwellMinutes: 60,
      maxDistanceM: 60,
      autoAccept: false,
    });
  });

  it("refuses a window whose maximum is below its minimum before sending", async () => {
    render(
      <BrandRuleDialog
        listId="l1"
        rule={{
          listId: "l1",
          brands: [{ brandWikidataId: "Q38076", brandName: "McDonald's" }],
          minDwellMinutes: 30,
          maxDwellMinutes: 10,
          maxDistanceM: 60,
          autoAccept: false,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    expect(screen.getByText(/Höchstdauer muss mindestens/)).toBeInTheDocument();
  });
});
