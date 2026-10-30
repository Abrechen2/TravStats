import { isActualRecordDone } from "../actualRecordDone";

// forgejo#385 (RULE-38): the "record is done" list was hand-copied three times
// and carried "returned", a status no domain uses.
describe("isActualRecordDone", () => {
  it.each(["flown", "historical", "completed"])("%s is done", (s) => {
    expect(isActualRecordDone(s)).toBe(true);
  });
  it.each(["scheduled", "cancelled", "planned", "duplicated", "returned", ""])(
    "%s is not done",
    (s) => {
      expect(isActualRecordDone(s)).toBe(false);
    }
  );
});
