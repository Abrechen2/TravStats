import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FriendInvitePage from "../FriendInvitePage";
import { VALID_PAYLOAD, b64url } from "../../components/friends/__tests__/fixtures";

const state = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: (sel: (s: { user: unknown }) => unknown) => sel({ user: state.user }),
}));

const PAYLOAD = b64url(VALID_PAYLOAD);
const assign = vi.fn();
const open = (hash = `#${PAYLOAD}`) => {
  window.history.replaceState(null, "", `/freunde/einladung${hash}`);
  return render(
    <MemoryRouter>
      <FriendInvitePage />
    </MemoryRouter>
  );
};

describe("FriendInvitePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = null;
    window.localStorage.clear();
    const real = window.location;
    vi.stubGlobal("location", {
      get hash() {
        return real.hash;
      },
      get href() {
        return real.href;
      },
      assign,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("navigates to <own server>/freunde/annehmen#<payload>", () => {
    open();
    fireEvent.change(screen.getByLabelText("friends.invite.serverLabel"), {
      target: { value: "mine.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "friends.invite.open" }));
    expect(assign).toHaveBeenCalledWith(`https://mine.example/freunde/annehmen#${PAYLOAD}`);
    expect(window.localStorage.getItem("travstats.friends.homeServer")).toBe(
      "https://mine.example"
    );
  });

  it("remembers the own server for the next visit", () => {
    window.localStorage.setItem("travstats.friends.homeServer", "https://mine.example");
    open();
    expect(screen.getByLabelText("friends.invite.serverLabel")).toHaveValue("https://mine.example");
  });

  it("works with localStorage throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    open();
    fireEvent.change(screen.getByLabelText("friends.invite.serverLabel"), {
      target: { value: "https://mine.example/some/path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "friends.invite.open" }));
    expect(assign).toHaveBeenCalledWith(`https://mine.example/freunde/annehmen#${PAYLOAD}`);
  });

  it("refuses a server field that is no address and a damaged link, sending nothing", () => {
    open(`#${PAYLOAD.slice(0, -20)}`);
    expect(screen.getByText("friends.accept.damaged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "friends.invite.open" })).toBeNull();
  });

  it("tells a signed-in reader it may be their own server, and still offers the other", () => {
    state.user = { id: "u1" };
    open();
    expect(screen.getByText("friends.invite.ownServer")).toBeInTheDocument();
    expect(screen.getByLabelText("friends.invite.serverLabel")).toBeInTheDocument();
  });

  it("an address that is not a server keeps the button off", () => {
    open();
    fireEvent.change(screen.getByLabelText("friends.invite.serverLabel"), {
      target: { value: "ftp://nope" },
    });
    expect(screen.getByRole("button", { name: "friends.invite.open" })).toBeDisabled();
    expect(assign).not.toHaveBeenCalled();
  });
});
