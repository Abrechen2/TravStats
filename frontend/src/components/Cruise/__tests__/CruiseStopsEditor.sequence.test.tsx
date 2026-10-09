import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CruiseStopsEditor } from "../CruiseStopsEditor";
import type { CruiseStopInput, Port } from "../../../types";

/**
 * forgejo#224: before a day is moved or removed, the editor says which day
 * numbers, dates and excursion notes it touches; notes stay with their port;
 * "Hafenfolge rückgängig" takes back the last reorder.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o
        ? `${k}(${Object.entries(o)
            .map(([key, v]) => `${key}=${String(v)}`)
            .join(",")})`
        : k,
    i18n: { language: "de" },
  }),
}));
vi.mock("../PortPicker", () => ({
  PortPicker: ({ id, label }: { id?: string; label?: string }) => (
    <input id={id} aria-label={label} />
  ),
}));

const port = (id: number, name: string): Port =>
  ({ id, name, city: name, country: "X", lat: 0, lon: 0 }) as unknown as Port;

const call = (key: string, day: number, name: string, extra: Partial<CruiseStopInput> = {}) =>
  ({
    uiKey: key,
    portId: day,
    port: port(day, name),
    dayNumber: day,
    isAtSea: false,
    ...extra,
  }) as CruiseStopInput;

const ITINERARY = [
  call("kiel", 1, "Kiel"),
  call("oslo", 3, "Oslo", {
    excursionNote: "Holmenkollen",
    arrivalTime: "2026-10-07T08:00:00.000Z",
    departureTime: "2026-10-07T18:00:00.000Z",
  }),
  call("bergen", 4, "Bergen"),
];

function Harness(): JSX.Element {
  const [stops, setStops] = useState(ITINERARY);
  return (
    <>
      <CruiseStopsEditor stops={stops} onChange={setStops} idPrefix="t" startDate="2026-10-05" />
      <div data-testid="order">
        {stops.map((s) => `${s.port?.name}:${s.dayNumber}:${s.excursionNote ?? ""}`).join(",")}
      </div>
    </>
  );
}

const summaryOf = (key: string): HTMLElement => document.getElementById(`t-${key}-summary`)!;
const openDay = (): HTMLElement => document.querySelector<HTMLElement>("details[open]")!;

describe("CruiseStopsEditor — reorders explained and undone (forgejo#224)", () => {
  it("says which other day a move would push on, and its derived date, before the tap", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(summaryOf("bergen"));

    const up = within(openDay()).getByRole("button", { name: "stops.moveUp" });
    // Bergen keeps day 4; Oslo, behind it, would become day 5 — and its date
    // (derived from the start date) would follow.
    expect(up).toHaveAccessibleDescription(
      /stops\.preview\.up\(effect=stops\.preview\.shift\(title=Oslo,from=3,to=5\) \(stops\.preview\.shiftDate\(from=07\.10\.2026,to=09\.10\.2026\)\)\)/
    );
  });

  it("asks before a removal, naming the date, times and the note that go", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(summaryOf("oslo"));
    await user.click(within(openDay()).getByRole("button", { name: "stops.remove" }));

    const question = screen.getByRole("group", { name: /stops\.removeConfirm\.title/ });
    expect(question.textContent).toContain("stops.removeConfirm.times(arrive=08:00,depart=18:00)");
    expect(question.textContent).toContain("stops.removeConfirm.noteLost(note=Holmenkollen)");
    expect(question.textContent).toContain("stops.removeConfirm.othersKeep");
    const keep = within(question).getByRole("button", { name: "stops.removeConfirm.keep" });
    expect(document.activeElement).toBe(keep);

    // "Behalten" changes nothing and gives the focus back.
    await user.click(keep);
    expect(screen.getByTestId("order").textContent).toBe("Kiel:1:,Oslo:3:Holmenkollen,Bergen:4:");
    expect(document.activeElement?.id).toBe("t-oslo-remove");
  });

  it("takes back a removal with its note, and opens the day it brought back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(summaryOf("oslo"));
    await user.click(within(openDay()).getByRole("button", { name: "stops.remove" }));
    await user.click(screen.getByRole("button", { name: "stops.removeConfirm.confirm" }));
    expect(screen.getByTestId("order").textContent).toBe("Kiel:1:,Bergen:4:");

    const undo = screen.getByRole("button", { name: "stops.undo.button" });
    expect(undo).toHaveAccessibleDescription("stops.undo.scope");
    expect(screen.getByRole("status").textContent).toContain(
      "stops.undo.removed(title=Oslo,day=3)"
    );

    await user.click(undo);
    expect(screen.getByTestId("order").textContent).toBe("Kiel:1:,Oslo:3:Holmenkollen,Bergen:4:");
    expect(summaryOf("oslo").closest("details")).toHaveAttribute("open");
    expect(document.activeElement).toBe(summaryOf("oslo"));
    expect(screen.getByRole("status").textContent).toContain("stops.undo.done");
  });

  it("keeps a note with its port through a move, and takes the move back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(summaryOf("oslo"));
    await user.click(within(openDay()).getByRole("button", { name: "stops.moveDown" }));
    // Oslo keeps its note; it is pushed behind Bergen's day 4.
    expect(screen.getByTestId("order").textContent).toBe("Kiel:1:,Bergen:4:,Oslo:5:Holmenkollen");

    await user.click(screen.getByRole("button", { name: "stops.undo.button" }));
    expect(screen.getByTestId("order").textContent).toBe("Kiel:1:,Oslo:3:Holmenkollen,Bergen:4:");
    // One step taken back, nothing left to undo.
    expect(screen.queryByRole("button", { name: "stops.undo.button" })).toBeNull();
  });
});
