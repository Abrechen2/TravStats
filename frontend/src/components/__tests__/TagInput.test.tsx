import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TagInput from "../TagInput";

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/lib/api/tags", () => ({ tagsApi: { search: mocks.search } }));

function Harness({ initial = [] }: { initial?: string[] }): JSX.Element {
  const [tags, setTags] = useState<string[]>(initial);
  return <TagInput ariaLabel="Tags" value={tags} onChange={setTags} />;
}

const field = (): HTMLInputElement => screen.getByRole("combobox", { name: "Tags" });
const chips = (): string[] =>
  screen.queryAllByTestId(/^tag-remove-/).map((b) => b.getAttribute("data-testid")!.slice(11));

describe("TagInput", () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.search.mockResolvedValue([
      { name: "business", usageCount: 5 },
      { name: "Beach", usageCount: 3 },
    ]);
  });

  it("turns text into chips on Enter and on a comma", async () => {
    render(<Harness />);
    await userEvent.type(field(), "Food{Enter}city,");
    expect(chips()).toEqual(["Food", "city"]);
    expect(field()).toHaveValue("");
  });

  it("drops a case-insensitive duplicate and keeps the first spelling", async () => {
    render(<Harness initial={["Beach"]} />);
    await userEvent.type(field(), "beach{Enter} BEACH ,");
    expect(chips()).toEqual(["Beach"]);
  });

  it("splits a pasted list into chips", async () => {
    render(<Harness initial={["a"]} />);
    await userEvent.click(field());
    await userEvent.paste("b, c,, A , d");
    expect(chips()).toEqual(["a", "b", "c", "d"]);
  });

  it("takes the last chip back on Backspace in the empty field, and removes one on ×", async () => {
    render(<Harness initial={["one", "two", "three"]} />);
    await userEvent.type(field(), "{Backspace}");
    expect(chips()).toEqual(["one", "two"]);
    await userEvent.click(screen.getByTestId("tag-remove-one"));
    expect(chips()).toEqual(["two"]);
  });

  it("keeps text left in the field as a chip when focus leaves", async () => {
    render(<Harness />);
    await userEvent.type(field(), "unconfirmed");
    fireEvent.blur(field());
    expect(chips()).toEqual(["unconfirmed"]);
  });

  it("offers the user's tags, filtered by what is typed and not yet chosen", async () => {
    render(<Harness initial={["business"]} />);
    await userEvent.type(field(), "be");
    const list = await screen.findByRole("listbox");
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Beach/ })).toBeInTheDocument();
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith({ q: "be", limit: 8 }));
  });

  it("picks a suggestion with the arrow keys and Enter", async () => {
    render(<Harness />);
    await userEvent.click(field());
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(field().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /Beach/ }).id
    );
    await userEvent.keyboard("{Enter}");
    expect(chips()).toEqual(["Beach"]);
  });

  it("picks a suggestion by mouse without committing the typed prefix", async () => {
    render(<Harness />);
    await userEvent.type(field(), "bus");
    await userEvent.click(await screen.findByRole("option", { name: /business/ }));
    expect(chips()).toEqual(["business"]);
    expect(field()).toHaveValue("");
  });

  it("stays a plain tag field when the suggestions cannot load", async () => {
    mocks.search.mockRejectedValue(new Error("offline"));
    render(<Harness />);
    await userEvent.type(field(), "x{Enter}");
    expect(chips()).toEqual(["x"]);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers a vocabulary of the caller's own and then never asks the tag endpoint", async () => {
    const own = [
      { name: "Pool", usageCount: 4 },
      { name: "Parkplatz", usageCount: 2 },
      { name: "Sauna", usageCount: 1 },
    ];
    function Own(): JSX.Element {
      const [values, setValues] = useState<string[]>(["Sauna"]);
      return (
        <TagInput
          ariaLabel="Tags"
          value={values}
          onChange={setValues}
          suggestions={own}
          listLabel="Amenities"
        />
      );
    }
    render(<Own />);
    await userEvent.type(field(), "p");
    const list = screen.getByRole("listbox", { name: "Amenities" });
    expect(
      Array.from(list.querySelectorAll("li > span:first-child")).map((n) => n.textContent)
    ).toEqual(["Pool", "Parkplatz"]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /Parkplatz/ }));
    expect(chips()).toEqual(["Sauna", "Parkplatz"]);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
