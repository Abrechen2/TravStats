import { deadlineTimes, deadlinesUnchanged, resolveDeadlineColumns } from "../bookingDeadlines";
import { LODGING_STAY_FACT_FIELDS } from "../../sharing/facts/lodgingStay";
import { RENTAL_FACT_FIELDS } from "../../sharing/facts/rental";

/** forgejo#285 — the rules every deadline write and read goes through. */
describe("booking deadlines", () => {
  const ctx = (zone: string | null) => ({ userId: "u", placeZone: () => zone, viaToken: false });

  it("writes only the keys that were sent", async () => {
    expect(await resolveDeadlineColumns({}, ctx("Europe/Berlin"))).toEqual({});
    expect(await resolveDeadlineColumns({ paymentDueOn: null }, ctx(null))).toEqual({
      paymentDueOn: null,
    });
  });

  it("stores a day-only cancellation as its day, with the place's zone or none", async () => {
    const day = { kind: "date" as const, date: "2027-04-30" };
    const atHotel = await resolveDeadlineColumns(
      { freeCancellationUntil: day },
      ctx("Europe/Berlin")
    );
    expect(atHotel.freeCancellationUntil).toBeNull();
    expect(atHotel.freeCancellationOn?.toISOString()).toBe("2027-04-30T00:00:00.000Z");
    expect(atHotel.freeCancellationZone).toBe("Europe/Berlin");
    const floating = await resolveDeadlineColumns({ freeCancellationUntil: day }, ctx(null));
    expect(floating.freeCancellationZone).toBeNull();
  });

  it("refuses an instant whose zone nobody can name", async () => {
    await expect(
      resolveDeadlineColumns(
        { freeCancellationUntil: { kind: "instant", utc: new Date(), bareZ: true } },
        ctx(null)
      )
    ).rejects.toMatchObject({ code: "TZ_UNRESOLVED", field: "freeCancellationUntil" });
  });

  it("reads an instant without its zone as not recorded rather than as UTC", () => {
    expect(
      deadlineTimes({ freeCancellationUntil: new Date(), freeCancellationZone: null })
        .freeCancellationUntil
    ).toBeNull();
  });

  it("compares resolved columns with the stored row by value", () => {
    const stored = { paymentDueOn: new Date("2027-04-15T00:00:00.000Z") };
    expect(deadlinesUnchanged({ paymentDueOn: new Date("2027-04-15T00:00:00.000Z") }, stored)).toBe(
      true
    );
    expect(deadlinesUnchanged({ paymentDueOn: null }, stored)).toBe(false);
  });

  it("keeps deadlines out of what a shared trip copies — they are the booker's terms", () => {
    const deadlineColumns = [
      "freeCancellationUntil",
      "freeCancellationOn",
      "freeCancellationZone",
      "paymentDueOn",
    ];
    for (const column of deadlineColumns) {
      expect(LODGING_STAY_FACT_FIELDS as readonly string[]).not.toContain(column);
      expect(RENTAL_FACT_FIELDS as readonly string[]).not.toContain(column);
    }
  });
});
