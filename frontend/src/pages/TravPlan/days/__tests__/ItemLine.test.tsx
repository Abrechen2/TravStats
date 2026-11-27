import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemLine, unplanItem } from "../ItemLine";
import type { PlanItem, PlanState } from "../../../../lib/api/travplan";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));
vi.mock("../../format", () => ({ planDay: (d: string) => d }));

const item = (over: Partial<PlanItem> = {}) =>
  ({
    id: "it1",
    title: "Monreale",
    kind: "activity",
    day: "2026-05-02",
    time: "10:00",
    duration: 120,
    timezone: null,
    place: "",
    note: "",
    booked: false,
    bookingId: null,
    stationId: null,
    execution: "unconfirmed",
    source: null,
    ...over,
  }) as PlanItem;
const withIdea = { ideas: [{ itemId: "it1" }] } as unknown as PlanState;
const days = ["2026-05-01", "2026-05-02", "2026-05-03"];

describe("ItemLine", () => {
  it("moves an entry to another day and keeps its time", async () => {
    const onWrite = vi.fn();
    render(<ItemLine item={item()} state={withIdea} days={days} busy={false} onWrite={onWrite} />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "days.moveItem:Monreale" }),
      "2026-05-03"
    );
    expect(onWrite).toHaveBeenCalledWith({
      type: "upsert",
      collection: "items",
      value: expect.objectContaining({
        id: "it1",
        day: "2026-05-03",
        time: "10:00",
        duration: 120,
      }),
    });
  });

  it("puts an idea's entry back among the ideas", async () => {
    const onWrite = vi.fn();
    render(<ItemLine item={item()} state={withIdea} days={days} busy={false} onWrite={onWrite} />);
    await userEvent.click(screen.getByRole("button", { name: "days.unplanItem:Monreale" }));
    expect(onWrite).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.objectContaining({ day: null }) })
    );
  });

  it("does not offer 'back to ideas' for an entry that is no idea, nor moves a booked one", () => {
    const plain = { ideas: [] } as unknown as PlanState;
    expect(unplanItem(plain, item())).toBeNull();
    render(
      <ItemLine
        item={item({ booked: true })}
        state={plain}
        days={days}
        busy={false}
        onWrite={vi.fn()}
      />
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
