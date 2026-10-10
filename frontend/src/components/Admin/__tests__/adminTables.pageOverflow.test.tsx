import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import UserManagement from "../UserManagement";
import InvitationManagement from "../InvitationManagement";
import type { AdminUser } from "../SystemInfo";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../store/authStore", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "admin-1" } }),
}));
vi.mock("../AdminPasswordResetModal", () => ({ default: () => null }));

const noop = (): void => {};

/**
 * forgejo#182: at 360px the admin page scrolled sideways as a whole
 * (documentElement.scrollWidth 621). The culprit was the users table's
 * `sr-only` "Actions" header — `position: absolute`, and with no positioned
 * ancestor inside the horizontal scroller its containing block lay OUTSIDE
 * it, so the scroller's clip did not apply and the 1px box at x≈620 widened
 * the document. jsdom cannot lay out, so this pins the structure that
 * prevents it: the scroller around a wide table is itself positioned, and
 * so is the containing block of every absolutely positioned element in it.
 */
function scrollerOf(table: HTMLElement): HTMLElement {
  let el: HTMLElement | null = table.parentElement;
  while (el && !/\boverflow-x-auto\b/.test(el.className)) el = el.parentElement;
  if (!el) throw new Error("table has no horizontal scroller");
  return el;
}

function expectScrollerContains(container: HTMLElement): void {
  const table = container.querySelector("table");
  expect(table).not.toBeNull();
  const scroller = scrollerOf(table as HTMLElement);
  expect(scroller.className).toMatch(/\brelative\b/);
}

describe("admin tables keep their width inside their own scroller (forgejo#182)", () => {
  it("the users table's scroller is the containing block of its sr-only header", () => {
    const { container } = render(
      <UserManagement
        users={[
          {
            id: "u1",
            username: "alex",
            isAdmin: false,
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            twoFactorEnabledAt: null,
            _count: { flights: 0, userAchievements: 0 },
          } as AdminUser,
        ]}
        onToggleUserActive={noop}
        onDeleteUser={noop}
        onResetTwoFactor={noop}
      />
    );
    expectScrollerContains(container);
    expect(container.querySelector("th .sr-only")).not.toBeNull();
  });

  it("the invitations table's scroller is positioned too", () => {
    const { container } = render(
      <InvitationManagement
        invitations={[]}
        statusFilter="active"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={noop}
      />
    );
    expectScrollerContains(container);
  });
});
