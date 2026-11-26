import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DayPlanSection } from "../DayPlanSection";
import type { PlanCtx } from "../../planContext";
import { calendarDays } from "../../planContext";
import type { PlanView } from "../../../../lib/api/travplan";
import { routePlan } from "../../route/__tests__/routeFixture";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));
vi.mock("../../format", () => ({
  planDay: (d: string) => d,
  planRange: (a: string, b: string) => `${a}–${b}`,
}));

const ctx = (plan: PlanView, days = calendarDays("2026-05-01", "2026-05-07")): PlanCtx =>
  ({ plan, state: plan.state, days, prefix: "/plan/route-trip" }) as unknown as PlanCtx;

const show = (c: PlanCtx) =>
  render(
    <MemoryRouter>
      <DayPlanSection ctx={c} />
    </MemoryRouter>
  );

describe("DayPlanSection", () => {
  it("shows every day with its night and the leg travelled on it", () => {
    const base = routePlan();
    show(
      ctx({
        ...base,
        schedule: {
          ...base.schedule!,
          stages: [{ stageId: "g1", departDay: "2026-05-03", arriveDay: "2026-05-03" }],
        },
      })
    );
    // 1.–2. in Kiel fold into one span; the travel day stands alone.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "2026-05-01–2026-05-02" })).toBeInTheDocument();
    expect(screen.getAllByText("days.night:Kiel")).toHaveLength(1);
    expect(screen.getByText("route.mode.drive: Kiel → Gothenburg")).toBeInTheDocument();
  });

  it("says which stations have no day yet and does not invent their nights", () => {
    const base = routePlan();
    show(
      ctx({
        ...base,
        schedule: {
          ...base.schedule!,
          stations: [
            { stationId: "a", arriveDay: "2026-05-01", departDay: "2026-05-03" },
            { stationId: "b", arriveDay: null, departDay: null },
            { stationId: "c", arriveDay: null, departDay: null },
          ],
        },
      })
    );
    expect(screen.getByText(/days.undated:Gothenburg, Oslo/)).toBeInTheDocument();
    // The 3rd carries two bookings and stands alone; the 4th to 6th fold.
    expect(screen.getAllByText("days.nightUnknown")).toHaveLength(2);
    expect(screen.getByText("days.numbers:4,6")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "days.toRoute" })).toHaveAttribute(
      "href",
      "/plan/route-trip/workspace"
    );
  });

  it("asks for dates when the trip has none", () => {
    show(ctx(routePlan(), []));
    expect(screen.getByText("days.noDates")).toBeInTheDocument();
  });
});

describe("DayPlanSection on a long stay", () => {
  it("shows quiet days on one campsite as one span", () => {
    show(ctx(routePlan()));
    // Kiel 1.–2. folds; Gothenburg 3. has bookings, Oslo 4.–6. folds, the last day stands alone.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
    expect(screen.getByText("days.numbers:4,6")).toBeInTheDocument();
  });
});

describe("planning an idea from the day plan", () => {
  const ideas = [
    {
      id: "i1",
      title: "Teatro Massimo",
      category: "Kultur",
      priority: "maybe",
      note: "",
      itemId: null,
    },
    { id: "i2", title: "Monreale", category: "Ausflug", priority: "must", note: "", itemId: null },
  ] as PlanView["state"]["ideas"];

  it("puts a picked idea on the chosen day of a folded span, must-dos offered first", async () => {
    const base = routePlan();
    const mutate = vi.fn().mockResolvedValue(true);
    render(
      <MemoryRouter>
        <DayPlanSection
          ctx={{ ...ctx({ ...base, state: { ...base.state, ideas } }), mutate, busy: false }}
        />
      </MemoryRouter>
    );
    const spanCard = screen
      .getByRole("heading", { name: "2026-05-04–2026-05-06" })
      .closest("div")!.parentElement!;
    const dayPicker = within(spanCard).getByRole("combobox", { name: "days.pickDay" });
    const ideaPicker = within(spanCard).getByRole("combobox", { name: "days.pickIdea" });
    expect(
      within(ideaPicker)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual(["days.pickIdeaPrompt:2", "Monreale · options.must", "Teatro Massimo"]);
    await userEvent.selectOptions(dayPicker, "2026-05-05");
    await userEvent.selectOptions(ideaPicker, "i2");
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "assign_idea", ideaId: "i2", day: "2026-05-05" })
    );
  });

  it("offers nothing when every idea already has a day", () => {
    const base = routePlan();
    show(ctx({ ...base, state: { ...base.state, ideas: [] } }));
    expect(screen.queryByRole("combobox", { name: "days.pickIdea" })).not.toBeInTheDocument();
  });
});

describe("working on a day", () => {
  const legPlan = () => {
    const base = routePlan();
    return {
      ...base,
      state: {
        ...base.state,
        tasks: [{ id: "t1", title: "Gas", due: "2026-05-03", done: false }],
      },
      schedule: {
        ...base.schedule!,
        stages: [{ stageId: "g1", departDay: "2026-05-03", arriveDay: "2026-05-03" }],
      },
    };
  };
  const render2 = (over: Partial<PlanCtx>) =>
    render(
      <MemoryRouter>
        <DayPlanSection ctx={{ ...ctx(legPlan()), busy: false, ...over }} />
      </MemoryRouter>
    );

  it("ticks a task off where it is due", async () => {
    const mutate = vi.fn().mockResolvedValue(true);
    render2({ mutate });
    await userEvent.click(screen.getByRole("checkbox", { name: "days.task:Gas" }));
    expect(mutate).toHaveBeenCalledWith({
      type: "upsert",
      collection: "tasks",
      value: expect.objectContaining({ id: "t1", done: true }),
    });
  });

  it("adds an entry on the day it was asked for", async () => {
    const edit = vi.fn();
    render2({ edit });
    const card = screen.getByRole("heading", { name: "2026-05-03" }).closest("div")!.parentElement!;
    await userEvent.click(within(card).getByRole("button", { name: "days.addEntry" }));
    expect(edit).toHaveBeenCalledWith("items", expect.objectContaining({ day: "2026-05-03" }));
  });

  it("opens the leg's editor from the day it is travelled", async () => {
    render2({});
    await userEvent.click(screen.getByRole("button", { name: "days.editLeg:Kiel,Gothenburg" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers to set the dates when the trip has none", async () => {
    const editTrip = vi.fn();
    render(
      <MemoryRouter>
        <DayPlanSection ctx={{ ...ctx(routePlan(), []), editTrip }} />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole("button", { name: "days.setDates" }));
    expect(editTrip).toHaveBeenCalled();
  });
});

describe("a folded span", () => {
  it("adds an entry on the day chosen inside the span, not on its first day", async () => {
    const edit = vi.fn();
    render(
      <MemoryRouter>
        <DayPlanSection ctx={{ ...ctx(routePlan()), edit, busy: false }} />
      </MemoryRouter>
    );
    const card = screen
      .getByRole("heading", { name: "2026-05-04–2026-05-06" })
      .closest("div")!.parentElement!;
    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "days.pickDay" }),
      "2026-05-05"
    );
    await userEvent.click(within(card).getByRole("button", { name: "days.addEntry" }));
    expect(edit).toHaveBeenCalledWith("items", expect.objectContaining({ day: "2026-05-05" }));
  });
});
