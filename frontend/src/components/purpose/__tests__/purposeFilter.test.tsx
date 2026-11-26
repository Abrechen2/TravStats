import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import PurposeFilterControl from "../PurposeFilterControl";
import { purposeApi } from "../../../lib/api/purpose";
import { purposeFilterFor, purposeFilterOf, setPurposeFilter } from "../../../lib/purposeFilter";

vi.mock("../../../lib/api/purpose", () => ({
  purposeApi: { usage: vi.fn(), catalogue: vi.fn() },
}));

function Where(): JSX.Element {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PurposeFilterControl />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => vi.clearAllMocks());
afterEach(() => setPurposeFilter(null));

describe("purpose filter: URL and requests", () => {
  it("reads the filter from the page URL only on pages that take it", () => {
    expect(purposeFilterOf({ pathname: "/flights", search: "?purpose=builtin:trade_fair" })).toBe(
      "builtin:trade_fair"
    );
    expect(purposeFilterOf({ pathname: "/settings", search: "?purpose=business" })).toBeNull();
    expect(purposeFilterOf({ pathname: "/trips", search: "?purpose=nonsense" })).toBeNull();
  });

  it("rides only on GETs of the entry routes while a page holds it", () => {
    setPurposeFilter("builtin:vacation");
    expect(purposeFilterFor("get", "/flights")).toBe("builtin:vacation");
    expect(purposeFilterFor("get", "/stats/years")).toBe("builtin:vacation");
    expect(purposeFilterFor("post", "/flights")).toBeNull();
    expect(purposeFilterFor("get", "/purpose/catalogue")).toBeNull();
    setPurposeFilter(null);
    expect(purposeFilterFor("get", "/flights")).toBeNull();
  });
});

describe("PurposeFilterControl", () => {
  it("writes the choice into the URL and keeps the other parameters", async () => {
    vi.mocked(purposeApi.usage).mockResolvedValue({ flight: { "builtin:trade_fair": 3 } });
    at("/flights?sort=date");
    await userEvent.selectOptions(screen.getByRole("combobox"), "builtin:trade_fair");
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/flights?sort=date&purpose=builtin%3Atrade_fair"
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "");
    expect(screen.getByTestId("where")).toHaveTextContent("/flights?sort=date");
  });

  it("names how many entries of the page's domain carry each purpose", async () => {
    vi.mocked(purposeApi.usage).mockResolvedValue({
      flight: { "builtin:trade_fair": 3, unknown: 2 },
      rail: { "builtin:trade_fair": 7 },
    });
    at("/flights");
    expect(
      await screen.findByRole("option", { name: /purpose:builtin\.trade_fair \(3\)/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "purpose:field.unknown (2)" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "purpose:filter.allOfKind.business (3)" })
    ).toBeInTheDocument();
  });

  it("says so when the counts could not be loaded, and still filters", async () => {
    vi.mocked(purposeApi.usage).mockRejectedValue(new Error("boom"));
    at("/trips");
    expect(await screen.findByRole("status")).toHaveTextContent("purpose:filter.countsFailed");
    await userEvent.selectOptions(screen.getByRole("combobox"), "unknown");
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/trips?purpose=unknown")
    );
  });

  it("renders nothing on a page that takes no filter", () => {
    vi.mocked(purposeApi.usage).mockResolvedValue({});
    at("/settings");
    expect(screen.queryByTestId("purpose-filter")).toBeNull();
  });
});
