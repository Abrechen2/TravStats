import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CruiseStopsEditor } from "../CruiseStopsEditor";
import type { CruiseStopInput, Port } from "../../../types";

/**
 * forgejo#221: a long itinerary is a compact list of days; only the chosen day
 * unfolds; move and remove are labelled, touch-sized buttons; the open day and
 * the focus follow a moved stop.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.day ? `${k}:${String(o.day)}` : k),
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

const stop = (day: number, name: string | null, extra: Partial<CruiseStopInput> = {}) =>
  ({
    portId: name ? day : null,
    port: name ? port(day, name) : null,
    dayNumber: day,
    isAtSea: name === null,
    ...extra,
  }) as CruiseStopInput;

function Harness({ initial }: { initial: CruiseStopInput[] }): JSX.Element {
  const [stops, setStops] = useState(initial);
  return (
    <>
      <CruiseStopsEditor stops={stops} onChange={setStops} idPrefix="t" />
      <div data-testid="order">{stops.map((s) => s.port?.name ?? "sea").join(",")}</div>
    </>
  );
}

const ITINERARY = [
  stop(1, "Kiel", { date: "2026-10-05T00:00:00.000Z", departureTime: "2026-10-05T17:00:00.000Z" }),
  stop(2, null),
  stop(3, "Oslo", {
    arrivalTime: "2026-10-07T08:00:00.000Z",
    departureTime: "2026-10-07T18:00:00.000Z",
    excursionNote: "Holmenkollen",
  }),
  stop(4, "Kopenhagen"),
];

const summaries = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("summary"));

/** The controls of the one opened day — closed days keep theirs in the DOM. */
const openDay = (): HTMLElement => {
  const open = document.querySelector<HTMLElement>("details[open]");
  if (!open) throw new Error("no day is open");
  return open;
};

describe("CruiseStopsEditor — compact day list (forgejo#221)", () => {
  it("shows one line per day and no day's fields until one is opened", () => {
    render(<Harness initial={ITINERARY} />);

    expect(summaries()).toHaveLength(4);
    expect(summaries()[2].textContent).toContain("stops.day 3");
    expect(summaries()[2].textContent).toContain("Oslo");
    expect(summaries()[2].textContent).toContain("08:00–18:00");
    expect(summaries()[2].textContent).toContain("stops.hasExcursion");
    expect(summaries()[1].textContent).toContain("stops.at_sea");
    // Every day folded: no date field, no move button is visible.
    for (const input of screen.getAllByLabelText("stops.date")) expect(input).not.toBeVisible();
    // The move and remove buttons exist for the opened day only.
    expect(screen.queryAllByRole("button", { name: /stops.moveUp/ })).toHaveLength(0);
  });

  it("unfolds only the chosen day", async () => {
    render(<Harness initial={ITINERARY} />);

    fireEvent.click(summaries()[2]);
    await waitFor(() => expect(document.getElementById("t-at-2-date")).toBeVisible());
    expect(document.getElementById("t-at-0-date")).not.toBeVisible();

    fireEvent.click(summaries()[0]);
    await waitFor(() => expect(document.getElementById("t-at-2-date")).not.toBeVisible());
    expect(document.getElementById("t-at-0-date")).toBeVisible();
    expect(document.querySelectorAll("details[open]")).toHaveLength(1);
  });

  it("names the move and remove buttons in words, with a touch size on a coarse pointer", async () => {
    render(<Harness initial={ITINERARY} />);
    fireEvent.click(summaries()[2]);
    const group = await screen.findByRole("group", { name: "stops.actionsLabel:3" });

    for (const name of ["stops.moveUp", "stops.moveDown", "stops.remove"]) {
      const button = within(group).getByRole("button", { name });
      expect(button.textContent).toContain(name);
      expect(button.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
      expect(button).not.toHaveAttribute("title");
    }
  });

  it("keeps the moved stop open and focused while it travels up the list", async () => {
    const user = userEvent.setup();
    render(<Harness initial={ITINERARY} />);
    await user.click(summaries()[3]);

    await user.click(within(openDay()).getByRole("button", { name: "stops.moveUp" }));
    expect(screen.getByTestId("order").textContent).toBe("Kiel,sea,Kopenhagen,Oslo");
    // The open day is Kopenhagen's, now third — not whatever stop is fourth.
    expect(summaries()[2].closest("details")).toHaveAttribute("open");
    expect(summaries()[3].closest("details")).not.toHaveAttribute("open");
    expect(document.activeElement?.id).toBe("t-at-3-up");

    // The keyboard carries on from the button that kept focus.
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("order").textContent).toBe("Kopenhagen,Kiel,sea,Oslo");
    // At the top "Nach oben" is disabled; focus moved on to "Nach unten".
    expect(document.activeElement?.id).toBe("t-at-3-down");
    expect(summaries()[0].closest("details")).toHaveAttribute("open");
  });

  it("puts focus on the day that took a removed day's place", async () => {
    const user = userEvent.setup();
    render(<Harness initial={ITINERARY} />);
    await user.click(summaries()[1]);

    await user.click(within(openDay()).getByRole("button", { name: "stops.remove" }));
    // Since forgejo#224 a removal asks once more.
    await user.click(screen.getByRole("button", { name: "stops.removeConfirm.confirm" }));
    expect(screen.getByTestId("order").textContent).toBe("Kiel,Oslo,Kopenhagen");
    expect(document.activeElement).toBe(summaries()[1]);
    expect(summaries()[1].textContent).toContain("Oslo");
  });

  it("opens and focuses a newly added day", async () => {
    const user = userEvent.setup();
    render(<Harness initial={ITINERARY.slice(0, 1)} />);

    await user.click(screen.getByRole("button", { name: /stops.add/ }));
    expect(summaries()).toHaveLength(2);
    expect(summaries()[1].textContent).toContain("stops.noPort");
    expect(summaries()[1].closest("details")).toHaveAttribute("open");
    expect(document.activeElement).toBe(summaries()[1]);
  });

  // forgejo#223: its own field, never filled from the departure.
  it("takes the all-aboard time in a field of its own, empty beside a departure", async () => {
    const user = userEvent.setup();
    render(<Harness initial={ITINERARY} />);
    await user.click(summaries()[0]);
    const field = document.getElementById("t-at-0-all-aboard") as HTMLInputElement;
    expect(field).toHaveAccessibleName("stops.allAboard");
    expect(field).toHaveAccessibleDescription("stops.allAboardHint");
    // Kiel departs 17:00; nothing is put into the all-aboard time for it.
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "16:30" } });
    expect(field.value).toBe("16:30");
  });

  // Review M2/M1: ticking "Auf See" on an imported port is undone by unticking
  // it — the name and the all-aboard time come back — and a sea day carries no
  // all-aboard time meanwhile.
  it("brings an unresolved port back when 'Auf See' is unticked again", async () => {
    const user = userEvent.setup();
    const colon = {
      portId: null,
      dayNumber: 4,
      isAtSea: false,
      unresolvedPortName: "Colón",
      allAboardTime: "16:30",
    } as CruiseStopInput;
    render(<Harness initial={[colon]} />);
    await user.click(summaries()[0]);
    const sea = within(openDay()).getByRole("checkbox", { name: "stops.at_sea" });

    await user.click(sea);
    expect(summaries()[0].textContent).toContain("stops.at_sea");
    await user.click(sea);
    expect(summaries()[0].textContent).toContain("Colón");
    expect((document.getElementById("t-at-0-all-aboard") as HTMLInputElement).value).toBe("16:30");
  });
});
