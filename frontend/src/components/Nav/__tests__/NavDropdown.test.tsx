import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import NavDropdown from "../NavDropdown";
import type { NavGroup } from "../useNavItems";

const group: NavGroup = {
  kind: "group",
  id: "logbook",
  label: "Logbuch",
  children: [
    { kind: "leaf", id: "domain-flight", path: "/flights", label: "Flüge" },
    { kind: "leaf", id: "domain-cruise", path: "/cruises", label: "Kreuzfahrten" },
  ],
};

function renderDd() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <NavDropdown group={group} />
    </MemoryRouter>
  );
}

describe("NavDropdown", () => {
  it("is closed initially and opens on trigger click", () => {
    renderDd();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Logbuch/ }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Logbuch/ }).getAttribute("aria-expanded")).toBe(
      "true"
    );
  });

  it("renders children as router links", () => {
    renderDd();
    fireEvent.click(screen.getByRole("button", { name: /Logbuch/ }));
    const flights = screen.getByRole("menuitem", { name: "Flüge" });
    expect(flights.getAttribute("href")).toBe("/flights");
  });

  it("closes on Escape", () => {
    renderDd();
    fireEvent.click(screen.getByRole("button", { name: /Logbuch/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when a child link is clicked", () => {
    renderDd();
    fireEvent.click(screen.getByRole("button", { name: /Logbuch/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Flüge" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders external links with target=_blank", () => {
    render(
      <MemoryRouter>
        <NavDropdown
          label="Support"
          externalLinks={[{ id: "donate", label: "Donate", href: "https://example.org" }]}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Support/ }));
    const a = screen.getByRole("menuitem", { name: "Donate" });
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("caps the trigger badge at 9+", () => {
    render(
      <MemoryRouter>
        <NavDropdown group={{ ...group, badge: 12 }} />
      </MemoryRouter>
    );
    expect(screen.getByText("9+")).toBeTruthy();
  });
});
