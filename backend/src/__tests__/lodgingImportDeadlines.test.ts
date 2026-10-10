import { prisma } from "../db";
import { commitLodgingImport } from "../services/lodging/lodgingImportCommit";
import { bookingsToCandidates } from "../services/lodging/lodgingCandidates";
import type { ParsedLodgingBooking } from "../services/lodging/parsedLodgingBooking";
import type { CommitRowInput } from "../schemas/lodgingImport";

/**
 * forgejo#285: the deadlines a lodging template reads travel from the parsed
 * booking through the import candidate into the stored stay — placed on the
 * hotel's clock, a bare day kept as a day. Invented sample data only.
 */
jest.mock("../services/fx/resolver", () => ({
  convertToBase: jest.fn(async () => null),
  resolveRate: jest.fn(async () => null),
}));
jest.mock("../services/geo/nominatim", () => ({
  geocodeAddress: async () => null,
  resolveCoordinates: async () => null,
}));

const parsed = (over: Partial<ParsedLodgingBooking>): ParsedLodgingBooking => ({
  hotelName: "Hotel Beispiel",
  checkIn: "2027-05-02",
  checkOut: "2027-05-04",
  nights: 2,
  roomCategory: null,
  address: null,
  postcode: null,
  city: "Musterstadt",
  country: null,
  totalPrice: null,
  pricePerNight: null,
  currency: null,
  board: null,
  guests: null,
  type: null,
  chainName: null,
  confirmationNumber: null,
  parserTemplate: "example",
  parserConfidence: 80,
  missing: [],
  ...over,
});

/** The candidate as the preview hands it back, with a position the zone resolver can read. */
function row(booking: ParsedLodgingBooking, index: number): CommitRowInput {
  const [candidate] = bookingsToCandidates([booking]);
  return {
    ...candidate,
    sourceRowIndex: index,
    action: "create",
    // Berlin: the hotel's zone is Europe/Berlin.
    lodging: {
      ...candidate.lodging!,
      name: `${booking.hotelName} ${index}`,
      lat: 52.52,
      lon: 13.4,
    },
  } as CommitRowInput;
}

describe("lodging import — deadlines from a template (forgejo#285)", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `lodging-deadlines-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("the candidate carries what was read, and nothing when nothing was", () => {
    const [withDeadlines] = bookingsToCandidates([
      parsed({ freeCancellationUntil: "2027-04-30T18:00", paymentDueOn: "2027-04-01" }),
    ]);
    expect(withDeadlines.stay).toMatchObject({
      freeCancellationUntil: "2027-04-30T18:00",
      paymentDueOn: "2027-04-01",
    });
    const [without] = bookingsToCandidates([parsed({})]);
    expect(without.stay).not.toHaveProperty("freeCancellationUntil");
  });

  it("stores a cancellation time on the hotel's clock and the payment day without a zone", async () => {
    const result = await commitLodgingImport(userId, "email", null, [
      row(parsed({ freeCancellationUntil: "2027-04-30T18:00", paymentDueOn: "2027-04-01" }), 0),
    ]);
    expect(result.failed).toEqual([]);
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { batchId: result.batchId } });
    // 18:00 in Berlin in summer time is 16:00 UTC.
    expect(stay.freeCancellationUntil?.toISOString()).toBe("2027-04-30T16:00:00.000Z");
    expect(stay.freeCancellationZone).toBe("Europe/Berlin");
    expect(stay.freeCancellationOn).toBeNull();
    expect(stay.paymentDueOn?.toISOString().slice(0, 10)).toBe("2027-04-01");
  });

  it("keeps a day-only cancellation as that day — no hour is made up", async () => {
    const result = await commitLodgingImport(userId, "email", null, [
      row(parsed({ freeCancellationUntil: "2027-04-30" }), 1),
    ]);
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { batchId: result.batchId } });
    expect(stay.freeCancellationUntil).toBeNull();
    expect(stay.freeCancellationOn?.toISOString().slice(0, 10)).toBe("2027-04-30");
  });

  it("imports the stay without a cancellation time it cannot place, keeping the payment day", async () => {
    const [candidate] = bookingsToCandidates([
      parsed({ freeCancellationUntil: "2027-04-30T18:00", paymentDueOn: "2027-04-01" }),
    ]);
    // No position: the hotel has no zone, so 18:00 names no instant.
    const result = await commitLodgingImport(userId, "email", null, [
      {
        ...candidate,
        sourceRowIndex: 2,
        action: "create",
        lodging: { ...candidate.lodging!, name: "Hotel ohne Ort" },
      } as CommitRowInput,
    ]);
    expect(result.failed).toEqual([]);
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { batchId: result.batchId } });
    expect(stay.freeCancellationUntil).toBeNull();
    expect(stay.freeCancellationOn).toBeNull();
    expect(stay.paymentDueOn?.toISOString().slice(0, 10)).toBe("2027-04-01");
  });
});
