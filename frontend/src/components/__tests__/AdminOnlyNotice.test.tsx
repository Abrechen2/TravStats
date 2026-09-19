import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AdminOnlyNotice } from "../AdminOnlyNotice";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * forgejo#88 finding 7.
 *
 * `/admin` answered a signed-in non-admin with `<Navigate to="/" />`. The API
 * was already right — `GET /api/v1/admin/users` as a normal account is a 403,
 * measured on the live stack 2026-09-19 — but the UI said nothing, so an admin
 * link followed from a changelog or a forum post was indistinguishable from a
 * dead address.
 */
describe("AdminOnlyNotice", () => {
  it("names the cause and does not offer an action a normal account cannot take", () => {
    render(
      <MemoryRouter>
        <AdminOnlyNotice />
      </MemoryRouter>
    );

    expect(screen.getByText("common:adminOnly.title")).toBeTruthy();
    expect(screen.getByText("common:adminOnly.body")).toBeTruthy();
    // No button: there is nothing here a normal account can change, and a
    // "back to dashboard" link only repeats what the chrome already offers.
    expect(screen.queryByRole("link")).toBeNull();
  });
});

/**
 * The notice is worthless if the router never reaches it — exactly the failure
 * mode `DomainRouteGuard.test.tsx` documents for the detail routes. So this
 * reads the real router, with an idle probe first: a source scan pointed at the
 * wrong file passes forever without looking at anything.
 */
describe("the /admin route explains itself rather than redirecting", () => {
  const routerSource = readFileSync(join(__dirname, "..", "..", "App.tsx"), "utf8");

  it("is reading the real router", () => {
    expect(routerSource.length).toBeGreaterThan(1000);
    expect(routerSource).toContain('path="/admin"');
  });

  it("draws the notice for a signed-in non-admin", () => {
    expect(routerSource).toContain("AdminOnlyNotice");
  });

  it("no longer sends a signed-in reader to the dashboard from /admin", () => {
    // The exact expression the audit met. An unauthenticated reader still goes
    // to /login — that is a sign-in prompt, not a silent bounce.
    expect(routerSource).not.toContain('<Navigate to={isAuthenticated ? "/" : "/login"} />');
  });
});
