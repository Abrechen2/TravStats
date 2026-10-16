import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import PeopleList from "../PeopleList";

describe("PeopleList", () => {
  it("draws a name list as before", () => {
    render(<PeopleList names={["Anna Berg"]} />);
    expect(screen.getByText("Anna Berg")).toBeTruthy();
    expect(screen.getByText("AB")).toBeTruthy();
  });

  it("draws rows with meta, badges and an action", () => {
    render(
      <PeopleList
        rows={[
          {
            key: "b",
            name: "Ben",
            meta: "@ben",
            badges: <span>linked</span>,
            action: <button>act</button>,
          },
        ]}
      />
    );
    expect(screen.getByText("@ben")).toBeTruthy();
    expect(screen.getByText("linked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "act" })).toBeTruthy();
  });

  it("draws two people of the same name without a key clash", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PeopleList names={["Anna", "Anna"]} />);
    expect(screen.getAllByText("Anna")).toHaveLength(2);
    expect(error.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    error.mockRestore();
  });
});
