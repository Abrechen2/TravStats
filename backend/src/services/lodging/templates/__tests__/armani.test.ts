import { READERS } from "./readers";

/**
 * Armani Hotels' own confirmation ("Your Reservation Confirmation at …"),
 * label-value lines in English. Measured 2026-10-01 on a private mailbox:
 * ten such mails (four direct, six forwarded) read as nothing. Every value
 * below is invented.
 */
const SUBJECT =
  "Your Reservation Confirmation at Armani Hotel Beispielstadt - (12345678) - Ms. Mustermann";
const BODY = [
  "Dear Ms. Erika Mustermann,",
  "Thank you for choosing to Stay with Armani.",
  "We are delighted to confirm your room reservation as follows:\t ",
  "CONFIRMATION NUMBER: 12345678 ",
  "Guest Name:\t Ms. Erika Mustermann\t ",
  "Check-In:\t Tuesday, 7 March 2028\t ",
  "Check-Out:\t Friday, 10 March 2028\t ",
  "Number of Rooms:\t 1\t ",
  "Guests:\t 2 Adults\t ",
  "Brief description of your Room category ",
  "Deluxe Room",
  "Rate per room per night ",
  "AED 1500.00",
  "Total cost of stay: AED 4500.00",
].join("\r\n");

describe.each(READERS)("the Armani Hotels reader — %s", (_reader, apply) => {
  const read = (subject: string) => apply("lodging:armani", subject, `${subject}\r\n${BODY}`);

  it("reads the hotel from the subject, both dates, the guests and the total", () => {
    const r = read(SUBJECT);
    expect(r).not.toBeNull();
    expect(r?.hotelName).toBe("Armani Hotel Beispielstadt");
    expect(r?.checkIn).toBe("2028-03-07");
    expect(r?.checkOut).toBe("2028-03-10");
    expect(r?.nights).toBe(3);
    expect(r?.confirmationNumber).toBe("12345678");
    expect(r?.guests).toBe(2);
    expect(r?.totalPrice).toBe(4500);
    expect(r?.currency).toBe("AED");
  });

  it("reads a forward of the confirmation", () => {
    expect(read(`Fwd: ${SUBJECT}`)?.hotelName).toBe("Armani Hotel Beispielstadt");
  });

  it("reads a forward whose mail program put every value on its own line", () => {
    const stacked = BODY.replace(/:\t /g, ":\r\n\r\n");
    expect(stacked).toContain("Check-In:\r\n\r\nTuesday");
    const r = apply("lodging:armani", `Fwd: ${SUBJECT}`, `Fwd: ${SUBJECT}\r\n${stacked}`);
    expect([r?.checkIn, r?.checkOut, r?.guests]).toEqual(["2028-03-07", "2028-03-10", 2]);
  });

  it("declines the hotel's reply in the same thread — it quotes the confirmation, it is not a second stay", () => {
    expect(read(`RE: ${SUBJECT}`)).toBeNull();
  });

  it("declines a newsletter from the hotel", () => {
    const newsletter =
      "Discover the Armani Hotel Beispielstadt\r\nCheck-In: from 3 pm\r\nBook now.";
    expect(
      apply("lodging:armani", "Summer at Armani", `Summer at Armani\r\n${newsletter}`)
    ).toBeNull();
  });
});
