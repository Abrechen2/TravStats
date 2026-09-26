import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { DomainKey } from "../../../shared/domains";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

let enabled: DomainKey[] = [];
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled, isEnabled: (key: DomainKey) => enabled.includes(key) }),
}));

const beta = vi.hoisted(() => ({ on: true }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: beta.on,
    isFeatureVisible: (key: string) => key === "loyaltyCenter" && beta.on,
  }),
}));

import UserMenu from "../UserMenu";
import LoyaltyLinkSection from "../../Settings/LoyaltyLinkSection";

const open = () => {
  render(
    <MemoryRouter>
      <UserMenu user={{ username: "alex" }} onLogout={vi.fn()} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button"));
};

describe("UserMenu — the loyalty page entry", () => {
  it("leads to the loyalty page when a domain with programmes is on", () => {
    beta.on = true;
    enabled = ["cruise"];
    open();
    expect(screen.getByRole("menuitem", { name: "loyalty:title" })).toHaveAttribute(
      "href",
      "/loyalty"
    );
  });

  it("is not drawn when no enabled domain has programmes — the page would be empty", () => {
    beta.on = true;
    enabled = ["poi"];
    open();
    expect(screen.queryByRole("menuitem", { name: "loyalty:title" })).toBeNull();
  });
});

// Owner decision 2026-09-26: the loyalty page is behind the beta switch.
describe("UserMenu — the loyalty entry and the beta switch", () => {
  it("is not drawn while the loyaltyCenter gate is closed", () => {
    beta.on = false;
    enabled = ["flight", "cruise", "lodging"];
    open();
    expect(screen.queryByRole("menuitem", { name: "loyalty:title" })).toBeNull();
  });
});

describe("LoyaltyLinkSection", () => {
  it("sends a domain's settings to that domain's section of the loyalty page", () => {
    render(
      <MemoryRouter>
        <LoyaltyLinkSection domain="flight" />
      </MemoryRouter>
    );
    expect(screen.getByTestId("loyalty-link-flight")).toHaveAttribute("href", "/loyalty#flight");
  });
});
