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

function renderMenu(props: Partial<React.ComponentProps<typeof UserMenu>> = {}) {
  const onLogout = props.onLogout ?? vi.fn();
  render(
    <MemoryRouter>
      <UserMenu user={user} onLogout={onLogout} {...props} />
    </MemoryRouter>,
  );
  return { onLogout };
}

describe("UserMenu", () => {
  it("greets by first name and shows initials when there is no picture", () => {
    renderMenu();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("prefers the profile picture over initials", () => {
    renderMenu({ profilePicture: "/uploads/avatar.png" });
    expect(screen.queryByText("AK")).not.toBeInTheDocument();
    expect(document.querySelector('img[src="/uploads/avatar.png"]')).toBeTruthy();
  });

  it("keeps the menu closed until asked", () => {
    renderMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens with an edit-profile link and a logout entry", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // The anchor carries role="menuitem" (correct inside role="menu"), which
    // overrides its implicit "link" role — so query the menu role, not the link.
    expect(screen.getByRole("menuitem", { name: "Profil bearbeiten" })).toHaveAttribute(
      "href",
      "/settings?tab=general&section=profile",
    );
    expect(screen.getByRole("menuitem", { name: "dashboard:logout" })).toBeInTheDocument();
  });

  // The whole point of hiding logout in here: it must take a deliberate click,
  // not a stray one in the top-right corner.
  it("logs out only from inside the open menu", () => {
    const { onLogout } = renderMenu();
    expect(onLogout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: "dashboard:logout" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a click elsewhere", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("falls back to the username when no real name is stored", () => {
    render(
      <MemoryRouter>
        <UserMenu user={{ username: "akuenzel" }} onLogout={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("akuenzel")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
