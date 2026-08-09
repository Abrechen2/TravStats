import {
  deriveFlightStatus,
  deriveCruiseStatus,
  deriveLodgingStatus,
  deriveTripStatus,
} from "../statusDerivation";

const H = 60 * 60 * 1000;
const now = new Date("2026-07-17T12:00:00Z");
const past = (h: number) => new Date(now.getTime() - h * H);
const future = (h: number) => new Date(now.getTime() + h * H);

describe("deriveFlightStatus", () => {
  it("passes through cancelled/historical/duplicated untouched", () => {
    for (const s of ["cancelled", "historical", "duplicated"]) {
      expect(
        deriveFlightStatus({ departureTime: past(100), arrivalTime: past(99), current: s, now })
      ).toBe(s);
    }
  });

  it("arrival more than 6h past -> flown; within slack -> scheduled", () => {
    expect(
      deriveFlightStatus({ departureTime: past(9), arrivalTime: past(7), current: "scheduled", now })
    ).toBe("flown");
    expect(
      deriveFlightStatus({ departureTime: past(7), arrivalTime: past(5), current: "scheduled", now })
    ).toBe("scheduled");
  });

  it("future-dated 'flown' reverts to scheduled (the zombie-anomaly killer)", () => {
    expect(
      deriveFlightStatus({ departureTime: future(24), arrivalTime: future(26), current: "flown", now })
    ).toBe("scheduled");
  });

  it("null arrival falls back to departure + 30h", () => {
    expect(
      deriveFlightStatus({ departureTime: past(31), arrivalTime: null, current: "scheduled", now })
    ).toBe("flown");
    expect(
      deriveFlightStatus({ departureTime: past(29), arrivalTime: null, current: "scheduled", now })
    ).toBe("scheduled");
  });

  it("no dates at all keeps the current status", () => {
    expect(
      deriveFlightStatus({ departureTime: null, arrivalTime: null, current: "flown", now })
    ).toBe("flown");
  });
});

describe("deriveCruiseStatus", () => {
  it("passes through cancelled/historical", () => {
    for (const s of ["cancelled", "historical"]) {
      expect(
        deriveCruiseStatus({ startDate: past(100), endDate: past(50), current: s, now })
      ).toBe(s);
    }
  });

  it("future start -> scheduled; between start and end -> in_progress; past end+48h -> flown", () => {
    expect(
      deriveCruiseStatus({ startDate: future(24), endDate: future(120), current: "scheduled", now })
    ).toBe("scheduled");
    expect(
      deriveCruiseStatus({ startDate: past(24), endDate: future(72), current: "scheduled", now })
    ).toBe("in_progress");
    expect(
      deriveCruiseStatus({ startDate: past(200), endDate: past(49), current: "scheduled", now })
    ).toBe("flown");
  });

  it("end within the 48h slack stays in_progress", () => {
    expect(
      deriveCruiseStatus({ startDate: past(200), endDate: past(47), current: "flown", now })
    ).toBe("in_progress");
  });

  it("null start + future end is not in_progress — a not-yet-started cruise stays scheduled", () => {
    expect(
      deriveCruiseStatus({ startDate: null, endDate: future(72), current: "scheduled", now })
    ).toBe("scheduled");
  });

  it("missing end: no in_progress — scheduled until start+48h past, then flown", () => {
    expect(
      deriveCruiseStatus({ startDate: past(47), endDate: null, current: "scheduled", now })
    ).toBe("scheduled");
    expect(
      deriveCruiseStatus({ startDate: past(49), endDate: null, current: "scheduled", now })
    ).toBe("flown");
  });

  it("no dates keeps current", () => {
    expect(deriveCruiseStatus({ startDate: null, endDate: null, current: "flown", now })).toBe(
      "flown"
    );
  });
});

describe("deriveTripStatus", () => {
  it("null without dated segments", () => {
    expect(deriveTripStatus({ earliestStart: null, latestEnd: null, now })).toBeNull();
  });
  it("future start -> planned; spanning now -> in_progress; past end -> completed", () => {
    expect(deriveTripStatus({ earliestStart: future(24), latestEnd: future(72), now })).toBe(
      "planned"
    );
    expect(deriveTripStatus({ earliestStart: past(24), latestEnd: future(24), now })).toBe(
      "in_progress"
    );
    expect(deriveTripStatus({ earliestStart: past(72), latestEnd: past(24), now })).toBe(
      "completed"
    );
  });
  it("start-only trips: past start counts as completed, future as planned", () => {
    expect(deriveTripStatus({ earliestStart: past(24), latestEnd: null, now })).toBe("completed");
    expect(deriveTripStatus({ earliestStart: future(24), latestEnd: null, now })).toBe("planned");
  });
});

describe("deriveLodgingStatus", () => {
  const derive = (checkIn: Date | null, checkOut: Date | null, current = "scheduled") =>
    deriveLodgingStatus({ checkIn, checkOut, current, now });

  // Alex, Discord 2026-07-12: only "cancelled" stays a manual choice.
  it("passes cancelled through untouched, whatever the dates say", () => {
    expect(derive(past(72), past(24), "cancelled")).toBe("cancelled");
    expect(derive(future(24), future(72), "cancelled")).toBe("cancelled");
  });

  it("both dates in the future -> scheduled", () => {
    expect(derive(future(24), future(72))).toBe("scheduled");
  });

  it("check-in past, check-out future -> in_progress", () => {
    expect(derive(past(24), future(24))).toBe("in_progress");
  });

  it("both dates past -> completed", () => {
    expect(derive(past(72), past(24))).toBe("completed");
  });

  it("derives the same result no matter what the stored status claims", () => {
    // The stored column is a CACHE — a wrong value must never survive.
    for (const stored of ["scheduled", "in_progress", "completed"]) {
      expect(derive(past(72), past(24), stored)).toBe("completed");
    }
  });

  it("keeps the stored status when the stay has no dates at all", () => {
    expect(derive(null, null, "completed")).toBe("completed");
  });

  it("treats a one-ended stay by its known date rather than leaving it unconverged", () => {
    expect(derive(past(24), null)).toBe("completed");
    expect(derive(future(24), null)).toBe("scheduled");
    expect(derive(null, past(24))).toBe("completed");
    expect(derive(null, future(24))).toBe("scheduled");
  });

  // Dates are UTC-pinned to midnight, so "check-out is today" must already read
  // completed — a morning check-out, and the only way a same-day stay avoids
  // being stuck in_progress forever.
  it("counts a stay as completed the moment check-out is reached, not after it", () => {
    expect(deriveLodgingStatus({ checkIn: past(48), checkOut: now, current: "scheduled", now })).toBe(
      "completed"
    );
  });

  it("a same-day stay is never in_progress once its date has arrived", () => {
    expect(deriveLodgingStatus({ checkIn: now, checkOut: now, current: "scheduled", now })).toBe(
      "completed"
    );
  });
});
