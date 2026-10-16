import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Button from "../../../ui/Button";

/**
 * The inbox workspace lets long action labels wrap on a phone. It did that by
 * overriding the Button primitive's inline height, padding and white-space with
 * `!important` — which beats every later rule, including any the primitive
 * itself adds, so the next change to Button would silently not apply here.
 * The primitive now exposes those three as context hooks, and the workspace
 * sets the hooks on its own root.
 */
describe("the workspace wraps its buttons through the primitive's hooks", () => {
  it("leaves !important out of the workspace stylesheet", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../workspace.css"), "utf8");
    expect(css).not.toMatch(/!important/);
    expect(css).toMatch(/--ts-button-height:\s*auto/);
    expect(css).toMatch(/--ts-button-white-space:\s*normal/);
  });

  it("reads the hooks with the primitive's own defaults as fallback", () => {
    render(<Button>Speichern</Button>);
    const style = screen.getByRole("button", { name: "Speichern" }).getAttribute("style") ?? "";
    expect(style).toContain("height: var(--ts-button-height, var(--ts-size-button-secondary))");
    expect(style).toContain("white-space: var(--ts-button-white-space, nowrap)");
    expect(style).toContain("padding: var(--ts-button-padding, 0 var(--ts-space-xl))");
  });
});
