import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const persisted = vi.hoisted(() => vi.fn());
vi.mock("../../../../store/persistSetting", () => ({ persistSetting: persisted }));

import { SectionFrame } from "../SectionFrame";
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
