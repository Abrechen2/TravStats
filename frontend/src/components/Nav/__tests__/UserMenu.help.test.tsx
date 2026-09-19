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

const openMenu = (props: Partial<React.ComponentProps<typeof UserMenu>> = {}): void => {
  render(
    <MemoryRouter>
      <UserMenu user={user} onLogout={vi.fn()} {...props} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button"));
};

/**
 * forgejo#88 finding 12.
 *
 * The account menu's only outward links were "Spenden", "Stern" and "Discord".
 * All three are ways to help the PROJECT; a beginner looking for help reads
 * them as none of the above, and the handbook at travstats.de/docs/ was linked
 * from exactly one place in the whole app (the usage-statistics consent card).
 *
 * Minimal on purpose: one entry, the docs that already exist. The "Stern"
 * wording the audit also flagged is left alone — renaming a support label is a
 * product decision, not a fix.
 */
describe("UserMenu — the help entry", () => {
  it("offers the handbook to every account", () => {
    openMenu();

    expect(screen.getByRole("menuitem", { name: "common:help.title" })).toHaveAttribute(
      "href",
      "https://travstats.de/docs/"
    );
  });

  it("opens it in a new tab without handing the opener over", () => {
    openMenu();
    const entry = screen.getByRole("menuitem", { name: "common:help.title" });

    expect(entry).toHaveAttribute("target", "_blank");
    expect(entry.getAttribute("rel")).toContain("noopener");
  });

  it("sits outside the support group — it is not a way of donating", () => {
    openMenu();
    const supportGroup = screen.getByRole("group", { name: "dashboard:nav.support" });

    expect(supportGroup).not.toContainElement(
      screen.getByRole("menuitem", { name: "common:help.title" })
    );
  });

  it("is there for an admin too, above the admin link's own neighbours", () => {
    openMenu({ isAdmin: true });

    expect(screen.getByRole("menuitem", { name: "common:help.title" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "dashboard:admin" })).toBeInTheDocument();
  });
});
