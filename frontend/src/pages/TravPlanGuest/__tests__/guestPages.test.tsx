import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import GuestJoinPage, { parseInviteFragment } from "../GuestJoinPage";
import { readVouchFragment } from "../GuestCallbackPage";
import { parseVouchRequest } from "../VouchPage";
import { rememberReturn, postLoginTarget, clearReturn } from "../../../lib/postLoginReturn";

const mocks = vi.hoisted(() => ({ startJoin: vi.fn(), t: (key: string) => key }));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../lib/api/travplanGuests", () => ({
  travplanGuestsApi: { startJoin: mocks.startJoin },
}));

const ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "s".repeat(43);

describe("the join links", () => {
  it("reads the invitation from the fragment and nothing malformed", () => {
    expect(parseInviteFragment(`#${ID}.${SECRET}`)).toEqual({ inviteId: ID, secret: SECRET });
    for (const bad of ["", "#", `#${ID}`, `#nope.${SECRET}`, `#${ID}.short`, `?${ID}.${SECRET}`])
      expect(parseInviteFragment(bad)).toBeNull();
  });

  it("reads a vouch from the fragment only", () => {
    expect(readVouchFragment("#vouch=" + "a".repeat(40) + ".b")).toBe("a".repeat(40) + ".b");
    expect(readVouchFragment("?vouch=" + "a".repeat(40))).toBeNull();
    expect(readVouchFragment("#vouch=a b")).toBeNull();
  });

  it("vouches only for a bare https origin, a uuid invitation and a 64 hex nonce", () => {
    const ok = new URLSearchParams({
      host: "https://host.example",
      invite: ID,
      nonce: "a".repeat(64),
    });
    expect(parseVouchRequest(ok)).toEqual({
      host: "https://host.example",
      invite: ID,
      nonce: "a".repeat(64),
    });
    for (const host of [
      "http://host.example",
      "https://host.example:8443",
      "https://host.example/path",
      "https://user@host.example",
      "javascript:alert(1)",
      "host.example",
    ])
      expect(
        parseVouchRequest(new URLSearchParams({ host, invite: ID, nonce: "a".repeat(64) })),
        host
      ).toBeNull();
    expect(
      parseVouchRequest(
        new URLSearchParams({ host: "https://h.example", invite: "x", nonce: "a".repeat(64) })
      )
    ).toBeNull();
    expect(
      parseVouchRequest(new URLSearchParams({ host: "https://h.example", invite: ID, nonce: "zz" }))
    ).toBeNull();
  });

  it("remembers only the vouch page across the login detour", () => {
    clearReturn();
    rememberReturn("/flights?x=1");
    expect(postLoginTarget()).toBe("/");
    rememberReturn(
      `/federation/vouch?host=https%3A%2F%2Fhost.example&invite=${ID}&nonce=${"a".repeat(64)}`
    );
    expect(postLoginTarget()).toContain("/federation/vouch?host=");
    clearReturn();
    expect(postLoginTarget()).toBe("/");
  });
});

describe("GuestJoinPage", () => {
  beforeEach(() => {
    mocks.startJoin.mockReset();
    window.location.hash = `#${ID}.${SECRET}`;
  });

  it("starts the join with the secret and sends the browser to the guest's own server", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, hash: `#${ID}.${SECRET}`, pathname: "/plan/join", assign },
      writable: true,
    });
    mocks.startJoin.mockResolvedValue({ vouchUrl: "https://guest.example/federation/vouch?x=1" });
    render(
      <MemoryRouter>
        <GuestJoinPage />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("button", { name: "guests.join.confirm" }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://guest.example/federation/vouch?x=1")
    );
    expect(mocks.startJoin).toHaveBeenCalledWith(ID, SECRET);
  });

  it("says why when the invitation is refused, in the refusal's own words", async () => {
    mocks.startJoin.mockRejectedValue({
      response: { status: 404, data: { code: "PLAN_GUEST_INVITE_INVALID" } },
    });
    render(
      <MemoryRouter>
        <GuestJoinPage />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("button", { name: "guests.join.confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("errors.PLAN_GUEST_INVITE_INVALID");
  });
});
