import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const persisted = vi.hoisted(() => vi.fn());
vi.mock("../../../../store/persistSetting", () => ({ persistSetting: persisted }));

import { SectionFrame } from "../SectionFrame";
import { DeepLinkedExpertNote, ExpertPageNotice } from "../ExpertNote";
import { SettingsMenuColumn } from "../SettingsMenu";
import { SettingsLevelSwitch } from "../SettingsLevelSwitch";
import { useExpertRows } from "../useExpertRows";
import { useStableScrollbar } from "../useStableScrollbar";
import { useSettingsLevelStore } from "../../../../store/settingsLevelStore";

function TwoExpertRows(): JSX.Element {
  const expert = useExpertRows(2);
  return <p>{expert ? "rows-shown" : "rows-hidden"}</p>;
}

describe("SectionFrame and expert rows (forgejo#321)", () => {
  beforeEach(() => {
    useSettingsLevelStore.setState({ level: "standard" });
    persisted.mockClear();
  });

  it("says how many settings the standard level hides in a section, and offers the switch", () => {
    render(
      <SectionFrame anchorId="settings-x" label="X">
        <TwoExpertRows />
      </SectionFrame>
    );
    expect(screen.getByText("rows-hidden")).toBeInTheDocument();
    const note = document.querySelector('[data-expert-note="settings"]');
    expect(note).toHaveTextContent("settings:level.moreSettings");

    fireEvent.click(screen.getByRole("button", { name: "settings:level.showExpert" }));
    expect(useSettingsLevelStore.getState().level).toBe("expert");
    expect(persisted).toHaveBeenCalledWith(
      { settingsLevel: "expert" },
      expect.any(Function),
      expect.any(String)
    );
    expect(screen.getByText("rows-shown")).toBeInTheDocument();
    expect(document.querySelector("[data-expert-note]")).toBeNull();
  });

  it("treats a level the server has not answered yet as expert — nothing vanishes on load", () => {
    useSettingsLevelStore.setState({ level: null });
    render(
      <SectionFrame anchorId="settings-x" label="X">
        <TwoExpertRows />
      </SectionFrame>
    );
    expect(screen.getByText("rows-shown")).toBeInTheDocument();
    expect(document.querySelector("[data-expert-note]")).toBeNull();
  });

  it("is a landmark named after its heading, with the anchor id links target", () => {
    render(
      <SectionFrame anchorId="admin-users" label="Benutzer" frame="card">
        <p>body</p>
      </SectionFrame>
    );
    const region = screen.getByRole("region", { name: "Benutzer" });
    expect(region).toHaveAttribute("id", "admin-users");
    // `card`: the frame draws the h2 the component does not.
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Benutzer");
  });

  it("shows the expert rows a link or search hit named, with a note, at the standard level", () => {
    render(
      <SectionFrame anchorId="settings-x" label="X" revealExpertRows>
        <TwoExpertRows />
      </SectionFrame>
    );
    expect(screen.getByText("rows-shown")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("settings:level.revealedRows");
    expect(document.querySelector('[data-expert-note="settings"]')).toBeNull();
  });

  it("notes a section shown only because a link named it", () => {
    render(
      <SectionFrame anchorId="settings-x" label="X" deepLinkedExpert>
        <p>body</p>
      </SectionFrame>
    );
    expect(screen.getByRole("status")).toHaveTextContent("settings:level.deepLinkedExpert");
  });
});

describe("the settings menu column", () => {
  it("stays in view while the page scrolls (tester, 2026-10-20)", () => {
    render(
      <MemoryRouter>
        <SettingsMenuColumn
          label="Einstellungen"
          groups={[
            {
              id: "g",
              label: null,
              entries: [{ id: "account", label: "Konto", to: "/settings/account", icon: "user" }],
            },
          ]}
          activeId="account"
          hiddenPages={2}
          search={null}
        />
      </MemoryRouter>
    );
    const aside = document.querySelector("[data-settings-menu]") as HTMLElement;
    expect(aside.style.position).toBe("sticky");
    expect(aside.style.top).not.toBe("");
    expect(screen.getByRole("link", { name: /Konto/ })).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('[data-expert-note="pages"]')).toHaveTextContent(
      "settings:level.morePages"
    );
  });
});

function Gutter(): null {
  useStableScrollbar();
  return null;
}

describe("the scrollbar gutter", () => {
  it("is reserved while a settings page is open and released after", () => {
    const { unmount } = render(<Gutter />);
    expect(document.documentElement.style.getPropertyValue("scrollbar-gutter")).toBe("stable");
    unmount();
    expect(document.documentElement.style.getPropertyValue("scrollbar-gutter")).toBe("");
  });
});

describe("the level switch", () => {
  beforeEach(() => persisted.mockClear());

  it("shows the account's level and stores a change with the account", () => {
    useSettingsLevelStore.setState({ level: "standard" });
    render(<SettingsLevelSwitch />);
    expect(screen.getByRole("radio", { name: "settings:level.standard" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "settings:level.expert" }));
    expect(useSettingsLevelStore.getState().level).toBe("expert");
    expect(persisted).toHaveBeenCalledWith(
      { settingsLevel: "expert" },
      expect.any(Function),
      expect.any(String)
    );
  });
});

describe("ExpertNote — touch size follows the pointer (forgejo#321, iPad look)", () => {
  const pointer = (coarse: boolean): void => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  };
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    useSettingsLevelStore.setState({ level: null });
  });

  it("gives the deep-link and expert-page notes' switch a 44 px target under a finger", () => {
    pointer(true);
    render(
      <>
        <DeepLinkedExpertNote />
        <ExpertPageNotice />
      </>
    );
    const buttons = screen.getAllByRole("button", { name: /level\.showExpert|Experten/i });
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b.style.minHeight).toBe("var(--ts-size-touch-min)");
  });

  it("keeps the notes' switch compact under a mouse", () => {
    pointer(false);
    render(<DeepLinkedExpertNote />);
    expect(screen.getByRole("button").style.minHeight).toBe("");
  });
});

describe("the surface tabs and breadcrumb (forgejo#321 prototype)", () => {
  it("offers the Administration tab to an admin, marking the open surface", async () => {
    const { SurfaceTabs } = await import("../SurfaceTabs");
    render(
      <MemoryRouter>
        <SurfaceTabs surface="admin" isAdmin />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "settings:frame.surface.settings" })).toHaveAttribute(
      "href",
      "/settings"
    );
    expect(screen.getByRole("link", { name: "settings:frame.surface.admin" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("gives an account without the permission no Administration tab", async () => {
    const { SurfaceTabs } = await import("../SurfaceTabs");
    render(
      <MemoryRouter>
        <SurfaceTabs surface="settings" isAdmin={false} />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "settings:frame.surface.admin" })).toBeNull();
    expect(screen.getByRole("link", { name: "settings:frame.surface.settings" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("names the surface and the page above the title", async () => {
    const { SettingsBreadcrumb } = await import("../SurfaceTabs");
    render(
      <MemoryRouter>
        <SettingsBreadcrumb surface="admin" page="Instanz" />
      </MemoryRouter>
    );
    const crumb = screen.getByRole("navigation", { name: "settings:frame.breadcrumb" });
    expect(crumb).toHaveTextContent("settings:frame.surface.admin›Instanz");
  });

  it("draws a domain page's colour as a dot in the menu", () => {
    render(
      <MemoryRouter>
        <SettingsMenuColumn
          label="Einstellungen"
          groups={[
            {
              id: "g",
              label: null,
              entries: [
                {
                  id: "flight",
                  label: "Flug",
                  to: "/settings/flight",
                  icon: "plane",
                  color: "#123456",
                },
                { id: "data", label: "Daten", to: "/settings/data", icon: "database" },
              ],
            },
          ]}
          activeId="flight"
          hiddenPages={0}
          search={null}
        />
      </MemoryRouter>
    );
    const dots = document.querySelectorAll("[data-domain-dot]");
    expect(dots).toHaveLength(1);
    expect((dots[0] as HTMLElement).style.background).toBe("rgb(18, 52, 86)");
  });
});
