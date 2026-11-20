import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AppShell from "../AppShell";

vi.mock("../../NavigationBar", () => ({ default: () => <nav /> }));
vi.mock("../../PageTransition", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// 2026-11-20 (owner): every page uses the full window width with the same
// gutter. The shell used to cap <main> at 720/1200/1440px by a `width` prop.
describe("AppShell full width", () => {
  it("does not cap or centre the page column (no narrow reading/list/table width)", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>page</p>
        </AppShell>
      </MemoryRouter>
    );
    const main = screen.getByText("page").closest("main") as HTMLElement;
    expect(main.style.maxWidth).toBe("");
    expect(main.style.margin).toBe("");
    expect(main.style.width).toBe("100%");
    expect(main.style.padding).toContain("var(--ts-space-screen-padding)");
  });

  it("ignores a legacy width prop instead of capping the page", () => {
    render(
      <MemoryRouter>
        <AppShell {...({ width: "reading" } as object)}>
          <p>legacy</p>
        </AppShell>
      </MemoryRouter>
    );
    expect((screen.getByText("legacy").closest("main") as HTMLElement).style.maxWidth).toBe("");
  });
});
