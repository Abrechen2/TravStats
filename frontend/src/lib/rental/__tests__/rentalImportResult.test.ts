import { describe, expect, it } from "vitest";
import { describeRentalImportSaved } from "../rentalImportResult";

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${JSON.stringify(options)})` : key;

describe("describeRentalImportSaved", () => {
  it("says only that the rental was taken over when no deadline was filled", () => {
    expect(describeRentalImportSaved([], t)).toBe("rental:import.saved");
  });

  it("names the deadlines a mail filled, like the lodging import does", () => {
    expect(describeRentalImportSaved(["freeCancellationUntil", "paymentDueOn"], t)).toBe(
      "rental:import.saved" +
        'rental:import.deadlinesFilledSuffix({"fields":"rental:import.deadlineField.freeCancellationUntil, rental:import.deadlineField.paymentDueOn"})'
    );
  });
});
