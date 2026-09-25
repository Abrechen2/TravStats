import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PhotoStrip, type StripPhoto } from "../PhotoStrip";

const photo = (id: string): StripPhoto => ({ id, url: `/p/${id}`, caption: id });

/**
 * The footer hands its photos to the strip — the visit's photo suggestions
 * link a picture and it must appear in the strip at once, and only once.
 */
describe("PhotoStrip footer", () => {
  it("merges the footer's photos into the strip without doubling one it holds", async () => {
    render(
      <PhotoStrip<StripPhoto>
        photos={[photo("a")]}
        context="test"
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        onCaption={vi.fn()}
        footer={(merge) => (
          <button type="button" onClick={() => merge([photo("a"), photo("b")])}>
            add
          </button>
        )}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "add" }));
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual([
      "/p/a",
      "/p/b",
    ]);
  });
});
