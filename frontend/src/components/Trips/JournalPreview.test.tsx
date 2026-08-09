import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import JournalPreview from "./JournalPreview";

describe("JournalPreview", () => {
  it("renders bold markdown as a strong element instead of literal asterisks", () => {
    // Alex's report (#231): the card showed "**Keniareise**" verbatim.
    render(<JournalPreview body="Heute hat unsere **Keniareise** begonnen." />);
    expect(screen.getByText("Keniareise").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("flattens a heading to plain text so a compact card cannot be blown up", () => {
    render(<JournalPreview body="## Tag 1" />);
    const node = screen.getByText("Tag 1");
    expect(node.tagName).not.toBe("H2");
    expect(node.closest("h1, h2, h3, h4, h5, h6")).toBeNull();
  });

  it("does not render images, which have no place in a two-line preview", () => {
    const { container } = render(<JournalPreview body="Strand ![Foto](https://x.test/s.jpg)" />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens a link in a new tab with the opener reference severed", () => {
    render(<JournalPreview body="Siehe [die Karte](https://example.com)" />);
    const link = screen.getByText("die Karte");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("caps a very long entry so one card cannot render a whole diary", () => {
    const body = "wort ".repeat(2000);
    const { container } = render(<JournalPreview body={body} />);
    expect(container.textContent!.length).toBeLessThan(600);
  });

  it("renders nothing at all for an empty body", () => {
    const { container } = render(<JournalPreview body="   " />);
    expect(container.textContent).toBe("");
  });
});
