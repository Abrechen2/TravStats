import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "de" },
  }),
}));

import UserMenu from "../UserMenu";

const user = { username: "akuenzel", firstName: "Alex", lastName: "Künzel" };

/**
 * T4 (2026-09-17 tester feedback): Admin used to sit in "Mehr › Werkzeuge"
 * (see `useNavItems.test.ts`). It now lives in the account menu, next to
 * settings — the same place a normal account's logout and support links
 * already are.
 */
describe("UserMenu — admin link (T4)", () => {
  it("offers a link to /admin when the account is an admin", () => {
    render(
      <MemoryRouter>
        <UserMenu user={user} onLogout={vi.fn()} isAdmin />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menuitem", { name: "dashboard:admin" })).toHaveAttribute(
      "href",
      "/admin"
    );
  });

  it("shows no admin link for a normal account", () => {
    render(
      <MemoryRouter>
        <UserMenu user={user} onLogout={vi.fn()} isAdmin={false} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("menuitem", { name: "dashboard:admin" })).not.toBeInTheDocument();
  });

  it("shows no admin link when isAdmin is left unset", () => {
    render(
      <MemoryRouter>
        <UserMenu user={user} onLogout={vi.fn()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("menuitem", { name: "dashboard:admin" })).not.toBeInTheDocument();
  });
});
