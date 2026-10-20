jest.mock("../../../parsers/userTemplates/v2UserTemplates", () => ({
  loadActiveWorkshopTemplates: jest.fn(),
}));

import { parseRentalBookingText } from "../rentalBookingParser";
import { loadActiveWorkshopTemplates } from "../../../parsers/userTemplates/v2UserTemplates";
import { deriveRentalTemplate } from "../../../parsers/userTemplates/rentalDeriver";
import {
  RENTAL_HELD_OUT,
  RENTAL_SELECTIONS,
  RENTAL_SOURCE,
  RENTAL_SUBJECT,
} from "../../../parsers/userTemplates/__tests__/rentalSamples";

/**
 * forgejo#309: a rental confirmation no repository template reads is read by
 * the caller's own ACTIVE workshop template, asked for by user and domain and
 * tried after the repository's.
 */
const mockLoad = loadActiveWorkshopTemplates as jest.Mock;

function workshopTemplate() {
  const result = deriveRentalTemplate({
    trainingDataId: "td-rental-parse",
    subject: RENTAL_SUBJECT,
    fullText: RENTAL_SOURCE,
    selections: RENTAL_SELECTIONS,
  });
  if (!result.ok) throw new Error(result.refusal);
  return result.template;
}

describe("parseRentalBookingText with the user's workshop templates", () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockLoad.mockResolvedValue([workshopTemplate()]);
  });

  it("reads a confirmation through the caller's active rental template", async () => {
    const result = await parseRentalBookingText(RENTAL_HELD_OUT, {
      subject: RENTAL_SUBJECT,
      userId: "user-1",
    });
    expect(mockLoad).toHaveBeenCalledWith("user-1", "rental");
    expect(result.parserUsed).toBe("template");
    expect(result.parserTemplate).toBe("user-td-rental-parse");
    expect(result.document).toMatchObject({
      kind: "confirmation",
      confirmationNumber: "MF-903311",
      pickup: { local: "2028-02-02T08:00" },
      return: { local: "2028-02-06" },
    });
  });

  it("asks for no workshop template without a user, and declines with its code", async () => {
    const result = await parseRentalBookingText(RENTAL_HELD_OUT, { subject: RENTAL_SUBJECT });
    expect(mockLoad).not.toHaveBeenCalled();
    expect(result.document).toBeNull();
    expect(result.fallbackCode).toBe("noTemplate");
  });
});
