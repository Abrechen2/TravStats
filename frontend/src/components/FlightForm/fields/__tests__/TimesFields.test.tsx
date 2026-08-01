import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TimesFields from "../TimesFields";

const VALUE = { depDate: "2026-08-14", depTime: "14:35", arrDate: "2026-08-14", arrTime: "16:50" };

describe("TimesFields", () => {
  it("renders four separate controls, not two combined ones", () => {
    render(<TimesFields value={VALUE} onChange={() => {}} />);
    expect(screen.getAllByLabelText(/datum|date/i)).toHaveLength(2);
    expect(screen.getAllByLabelText(/uhrzeit|time/i)).toHaveLength(2);
  });

  it("copies the departure date to arrival without touching the arrival time", async () => {
    const onChange = vi.fn();
    render(
      <TimesFields value={{ ...VALUE, arrDate: "2026-08-20" }} onChange={onChange} />
    );
    await userEvent.click(screen.getByRole("button", { name: /übernehmen|copy/i }));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next.arrDate).toBe("2026-08-14");
    expect(next.arrTime).toBe("16:50");
  });
});
