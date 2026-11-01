import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import CompareHandoverRow from "../CompareHandoverRow";

let demo = false;
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => demo }));

const renderRow = (row: "rangliste" | "verschl") =>
  render(
    <MemoryRouter initialEntries={["/settings/sharing"]}>
      <Routes>
        <Route path="/settings/sharing" element={<CompareHandoverRow row={row} withTitle />} />
        <Route path="/compare" element={<p>compare page</p>} />
        <Route path="/encrypted-share" element={<p>encrypted page</p>} />
      </Routes>
    </MemoryRouter>
  );

describe("CompareHandoverRow", () => {
  beforeEach(() => {
    demo = false;
  });

  it("leads the leaderboard row to /compare and the hand-over row to /encrypted-share: two features, two rows", async () => {
    const { unmount } = renderRow("rangliste");
    await userEvent.click(
      screen.getByRole("button", { name: /settingsRows:sharing.rangliste.btn/ })
    );
    expect(await screen.findByText("compare page")).toBeInTheDocument();
    unmount();
    renderRow("verschl");
    await userEvent.click(screen.getByRole("button", { name: /settingsRows:sharing.verschl.btn/ }));
    expect(await screen.findByText("encrypted page")).toBeInTheDocument();
  });

  it("is locked in the demo account, with the reason, and does not navigate", async () => {
    demo = true;
    renderRow("rangliste");
    const button = screen.getByRole("button", { name: /settingsRows:sharing.rangliste.btn/ });
    expect(button).toBeDisabled();
    expect(screen.getByText("settings:blocks.lock.demo")).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.queryByText("compare page")).toBeNull();
  });
});
