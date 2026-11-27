import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import InfoLine from "../InfoLine";

describe("InfoLine — one line inline, the detail behind an ⓘ", () => {
  it("keeps the long explanation out of the page until the ⓘ is opened", async () => {
    render(<InfoLine text="Kurz gesagt." more="Die lange Erklärung." subject="Thema" />);
    expect(screen.getByText("Kurz gesagt.")).toBeTruthy();
    expect(screen.queryByText("Die lange Erklärung.")).toBeNull();

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Die lange Erklärung.")).toBeTruthy();
  });

  it("draws no ⓘ when there is nothing more to say", () => {
    render(<InfoLine text="Nur eine Zeile." />);
    expect(screen.getByText("Nur eine Zeile.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
