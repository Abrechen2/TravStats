import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import PageErrorHost from "../PageErrorHost";
import { reportPageError, usePageErrorStore } from "../../store/pageErrorStore";

afterEach(() => {
  cleanup();
  usePageErrorStore.getState().clear();
});

describe("PageErrorHost", () => {
  it("shows a reported failure as a banner, once, until it is dismissed", async () => {
    render(
      <MemoryRouter>
        <PageErrorHost />
      </MemoryRouter>
    );
    act(() => {
      reportPageError("Speichern fehlgeschlagen");
      reportPageError("Speichern fehlgeschlagen");
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
