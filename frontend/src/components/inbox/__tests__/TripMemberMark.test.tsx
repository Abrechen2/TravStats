import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSettingsStore } from "../../../store/settingsStore";

const markMock = vi.fn();
vi.mock("../../../lib/api/operators", async (importActual) => {
  const actual = await importActual<typeof import("../../../lib/api/operators")>();
  return { ...actual, getOperatorMark: (...a: unknown[]) => markMock(...a) };
});

import TripMemberMark, { memberAccent } from "../TripMemberMark";
import type { TripSuggestionMember } from "../../../types/tripSuggestion";

const member = (over: Partial<TripSuggestionMember>): TripSuggestionMember => ({
  key: "k",
  domain: "flight",
  id: "1",
  label: "x",
  startDay: "2026-10-01",
  endDay: "2026-10-01",
  planned: false,
  ...over,
});

afterEach(() => {
  (useSettingsStore.getState().units as unknown as Record<string, unknown>).airlineLogoStyle =
    undefined;
  markMock.mockReset();
});

describe("inbox proposal members carry the operator's mark", () => {
  it("flight: airline tile, honouring the 'icon' style, code tile on failure", () => {
    (useSettingsStore.getState().units as unknown as Record<string, unknown>).airlineLogoStyle =
      "icon";
    render(<TripMemberMark member={member({ operator: "Lufthansa", airlineIata: "LH" })} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("/api/v1/airline-logos/LH?variant=icon");
    fireEvent.error(img);
    expect(screen.getByText("LH")).toBeInTheDocument();
  });

  it("rail: catalogue logo URL, monogram on failure", () => {
    render(<TripMemberMark member={member({ domain: "rail", operator: "Deutsche Bahn" })} />);
    const logo = screen.getByTestId("operator-logo");
    expect(logo.getAttribute("src")).toContain("/rail/operators/logo?name=Deutsche%20Bahn");
    fireEvent.error(logo);
    expect(screen.getByText("DB")).toBeInTheDocument();
  });

  it("bus: name-keyed operator service", async () => {
    markMock.mockResolvedValue({ available: true, source: "wikidata", credit: null });
    render(<TripMemberMark member={member({ domain: "bus", operator: "FlixBus" })} />);
    expect((await screen.findByTestId("operator-logo")).getAttribute("src")).toContain(
      "domain=bus&name=FlixBus"
    );
  });

  it("stay and place have no mark and ask nothing; their accent is the domain colour", () => {
    const { container } = render(<TripMemberMark member={member({ domain: "lodging" })} />);
    expect(container).toBeEmptyDOMElement();
    expect(markMock).not.toHaveBeenCalled();
    expect(memberAccent("lodging")).toBe("var(--ts-domain-hotel)");
    expect(memberAccent("place")).toBe("var(--ts-domain-poi)");
  });

  it("flight from an older server (no operator) shows no mark instead of a wrong one", () => {
    const { container } = render(<TripMemberMark member={member({})} />);
    expect(container).toBeEmptyDOMElement();
  });
});
