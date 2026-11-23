import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AttentionDot, AttentionMenuLine } from "../AttentionIndicator";
import { useReadinessShellStore } from "../../../store/readinessShellStore";
import { attentionOf } from "../../Settings/readiness/readinessModel";
import { SettingsMenuColumn } from "../../Settings/frame/SettingsMenu";
import UserMenu from "../../Nav/UserMenu";

/**
 * Readiness made visible (owner, 2026-11-23): the dot on the account button, the
 * menu line, and the glow of the Einrichtung entry — red for a problem, amber for
 * a warning, nothing when nothing is open. The server decides which items an
 * account counts (admin items for admins only, tested in
 * `readiness.attention.test.ts`); the shell shows exactly that number.
 */

const setAttention = (problem: number, warning: number) =>
  useReadinessShellStore.setState({ attention: { problem, warning } });

afterEach(() => {
  cleanup();
  useReadinessShellStore.getState().reset();
});

describe("attentionOf", () => {
  it("is red while a required item is open, amber for recommended only, nothing at zero", () => {
    expect(attentionOf({ problem: 1, warning: 2 })).toEqual({ tone: "problem", count: 3 });
    expect(attentionOf({ problem: 0, warning: 2 })).toEqual({ tone: "warning", count: 2 });
    expect(attentionOf({ problem: 0, warning: 0 })).toBeNull();
    expect(attentionOf(null)).toBeNull();
  });
});

describe("the account menu's indicator", () => {
  it("draws the dot with the count and the tone on the account button", () => {
    setAttention(0, 4);
    render(
      <MemoryRouter>
        <UserMenu user={{ username: "dennis" } as never} onLogout={() => undefined} />
      </MemoryRouter>
    );
    const dot = screen.getByTestId("attention-dot");
    expect(dot).toHaveTextContent("4");
    expect(dot.dataset.tone).toBe("warning");
    expect(dot.style.background).toBe("var(--ts-warn)");

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const line = screen.getByTestId("attention-menu-line");
    expect(line.getAttribute("href")).toBe("/settings/einrichtung");
    expect(line).toHaveTextContent("readiness:attention.menuLine");
  });

  it("turns red for a problem", () => {
    setAttention(1, 0);
    render(
      <MemoryRouter>
        <AttentionDot />
      </MemoryRouter>
    );
    expect(screen.getByTestId("attention-dot").style.background).toBe("var(--ts-bad)");
  });

  it("draws nothing when nothing needs attention, or before the first read", () => {
    render(
      <MemoryRouter>
        <AttentionDot />
        <AttentionMenuLine onNavigate={() => undefined} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("attention-dot")).toBeNull();
    act(() => setAttention(0, 0));
    expect(screen.queryByTestId("attention-dot")).toBeNull();
    expect(screen.queryByTestId("attention-menu-line")).toBeNull();
  });
});

describe("the settings menu's glow", () => {
  const menu = (attention?: { tone: string; color: string; count: number; label: string }) =>
    render(
      <MemoryRouter>
        <SettingsMenuColumn
          label="Einstellungen"
          groups={[
            {
              id: "konto",
              label: null,
              entries: [
                { id: "profil", label: "Profil", to: "/settings/profil", icon: "user" },
                {
                  id: "einrichtung",
                  label: "Einrichtung",
                  to: "/settings/einrichtung",
                  icon: "shield",
                  attention,
                },
              ],
            },
          ]}
          activeId="profil"
          hiddenPages={0}
          search={null}
        />
      </MemoryRouter>
    );

  it.each([
    ["problem", "var(--ts-bad)"],
    ["warning", "var(--ts-warn)"],
  ])("glows %s and carries the count", (tone, color) => {
    menu({ tone, color, count: 3, label: "3 Punkte" });
    const entry = screen.getByText("Einrichtung").closest("a")!;
    expect(entry.dataset.attention).toBe(tone);
    expect(entry.style.boxShadow).toContain(color);
    expect(screen.getByRole("img", { name: "3 Punkte" })).toHaveTextContent("3");
  });

  it("does not glow without anything open", () => {
    menu(undefined);
    const entry = screen.getByText("Einrichtung").closest("a")!;
    expect(entry.dataset.attention).toBeUndefined();
    expect(entry.style.boxShadow).toBe("");
  });
});
