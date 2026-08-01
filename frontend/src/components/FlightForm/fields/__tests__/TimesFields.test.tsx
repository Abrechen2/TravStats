import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TimesFields from "../TimesFields";

const VALUE = { depDate: "2026-08-14", depTime: "14:35", arrDate: "2026-08-14", arrTime: "16:50" };

const EMPTY_ACTUAL = {
  actualDepDate: "",
  actualDepTime: "",
  actualArrDate: "",
  actualArrTime: "",
};

describe("TimesFields", () => {
  it("renders four separate controls, not two combined ones", () => {
    render(<TimesFields value={VALUE} onChange={() => {}} />);
    expect(screen.getAllByLabelText(/datum|date/i)).toHaveLength(2);
    expect(screen.getAllByLabelText(/uhrzeit|time/i)).toHaveLength(2);
  });

  it("copies the departure date to arrival without touching the arrival time", async () => {
    const onChange = vi.fn();
    render(<TimesFields value={{ ...VALUE, arrDate: "2026-08-20" }} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /übernehmen|copy/i }));
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(next.arrDate).toBe("2026-08-14");
    expect(next.arrTime).toBe("16:50");
  });

  describe("actual times (#200)", () => {
    it("renders no actual-time inputs and no delay when actualValue/onActualChange are omitted", () => {
      render(<TimesFields value={VALUE} onChange={() => {}} />);
      expect(screen.queryByText(/actualTimes\.label/)).not.toBeInTheDocument();
      expect(screen.queryByTestId("timesFieldsDelay")).not.toBeInTheDocument();
      // Guard against a regression that silently renders actual fields even
      // without a change handler — still only 2+2 scheduled controls.
      expect(screen.getAllByLabelText(/datum|date/i)).toHaveLength(2);
      expect(screen.getAllByLabelText(/uhrzeit|time/i)).toHaveLength(2);
    });

    it("renders four actual date/time inputs when actualValue and onActualChange are supplied", () => {
      render(
        <TimesFields
          value={VALUE}
          onChange={() => {}}
          actualValue={EMPTY_ACTUAL}
          onActualChange={() => {}}
        />
      );
      // 2 scheduled + 2 actual date labels ("date" never collides with the
      // "actualTimes" namespace prefix the mocked t() echoes back).
      expect(screen.getAllByLabelText(/datum|date/i)).toHaveLength(4);
      // The mocked t() returns the raw i18n key, and "flights:actualTimes."
      // itself contains the substring "Times" — a loose /time/i regex would
      // also match the two ACTUAL DATE labels via their namespace prefix, not
      // just the four true *Time fields. Assert each control individually by
      // its exact (mocked) label text instead.
      expect(screen.getByLabelText("flights:form.departureTime")).toBeInTheDocument();
      expect(screen.getByLabelText("flights:form.arrivalTime")).toBeInTheDocument();
      expect(screen.getByLabelText("flights:actualTimes.actualDepartureTime")).toBeInTheDocument();
      expect(screen.getByLabelText("flights:actualTimes.actualArrivalTime")).toBeInTheDocument();
    });

    it("changing an actual field calls onActualChange with the updated value, and never onChange", async () => {
      const onChange = vi.fn();
      const onActualChange = vi.fn();
      render(
        <TimesFields
          value={VALUE}
          onChange={onChange}
          actualValue={EMPTY_ACTUAL}
          onActualChange={onActualChange}
        />
      );

      const actualDepDateInput = document.querySelector(
        "#timesFieldsActualDepDate"
      ) as HTMLInputElement;
      await userEvent.type(actualDepDateInput, "2026-08-14");

      expect(onActualChange).toHaveBeenCalled();
      const next = onActualChange.mock.calls[onActualChange.mock.calls.length - 1][0];
      expect(next.actualDepDate).toBe("2026-08-14");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("shows no delay text while the actual departure fields are empty", () => {
      render(
        <TimesFields
          value={VALUE}
          onChange={() => {}}
          actualValue={EMPTY_ACTUAL}
          onActualChange={() => {}}
        />
      );
      expect(screen.queryByTestId("timesFieldsDelay")).not.toBeInTheDocument();
    });

    it("shows a derived delayMinutes message, read-only, when the actual departure is later than scheduled", () => {
      render(
        <TimesFields
          value={VALUE}
          onChange={() => {}}
          actualValue={{ ...EMPTY_ACTUAL, actualDepDate: "2026-08-14", actualDepTime: "15:20" }}
          onActualChange={() => {}}
        />
      );
      const delayNode = screen.getByTestId("timesFieldsDelay");
      expect(delayNode.tagName).not.toBe("INPUT");
      expect(delayNode.textContent).toContain("flights:actualTimes.delayMinutes");
    });

    it("shows a derived earlyMinutes message when the actual departure is earlier than scheduled", () => {
      render(
        <TimesFields
          value={VALUE}
          onChange={() => {}}
          actualValue={{ ...EMPTY_ACTUAL, actualDepDate: "2026-08-14", actualDepTime: "14:00" }}
          onActualChange={() => {}}
        />
      );
      const delayNode = screen.getByTestId("timesFieldsDelay");
      expect(delayNode.textContent).toContain("flights:actualTimes.earlyMinutes");
    });

    it("shows the onTime label when the actual departure exactly matches scheduled", () => {
      render(
        <TimesFields
          value={VALUE}
          onChange={() => {}}
          actualValue={{ ...EMPTY_ACTUAL, actualDepDate: "2026-08-14", actualDepTime: "14:35" }}
          onActualChange={() => {}}
        />
      );
      const delayNode = screen.getByTestId("timesFieldsDelay");
      expect(delayNode.textContent).toContain("flights:actualTimes.onTimeLabel");
    });

    it("never renders the delay as an <input> — no delay input exists anywhere in the group", () => {
      const { container } = render(
        <TimesFields
          value={VALUE}
          onChange={() => {}}
          actualValue={{ ...EMPTY_ACTUAL, actualDepDate: "2026-08-14", actualDepTime: "15:20" }}
          onActualChange={() => {}}
        />
      );
      // 4 scheduled + 4 actual date/time inputs — exactly 8, none for delay.
      expect(container.querySelectorAll("input").length).toBe(8);
    });
  });
});
