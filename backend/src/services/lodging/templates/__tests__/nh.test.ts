import { READERS } from "./readers";

/**
 * NH Hotels' own confirmations, 2014–2016: the hotel under
 * "Hotelinformationen", its address as "Street. D-12345 City (Country)", and
 * the stay as "Check-in: dd/mm/yyyy - Check-out: dd/mm/yyyy". Measured
 * 2026-10-01 on a private mailbox: twelve of them, every one read as nothing.
 * Every value below is invented.
 */
const BODY = [
  "\t\tReservierungsbestätigung\t ",
  "Vielen Dank, dass Sie sich für NH Hoteles entschieden haben. Hiermit bestätigen wir Ihnen Ihre Reservierung:\t ",
  "Reservierungsnummer QXAB123456789 ",
  "Erstellt am 3. Januar 2017\t ",
  "Hotelinformationen\t ",
  // The real mails put image links and blank lines between heading and name.
  "\t",
  " <http://www.nh-hotels.com/nhobe/img/sep01.gif> \t",
  "\t",
  "\t NH Musterstadt City ",
  "Beispielweg 7. D-12345 Musterstadt (Deutschland)",
  "Telefon. +49 1 234567 - Fax. +49 1 234568",
  "E-Mail. musterstadt@nh-hotels.com <mailto:musterstadt@nh-hotels.com> ",
  "Informationen zur Reservierung\t ",
  "Check-in: 14/02/2017 - Check-out: 16/02/2017 - Übernachtung(en): 2\t ",
  "Gesamtpreis Ihres Aufenthaltes",
  "\t180.00 EUR + 12.60 MwSt. =",
  "192.60 EUR ",
].join("\r\n");

describe.each(READERS)("the NH Hotels reader — %s", (_reader, apply) => {
  const read = (subject: string, body: string) =>
    apply("lodging:nh", subject, `${subject}\r\n${body}`);

  it("reads the hotel, its address, both dates (day first) and the stay's total", () => {
    const r = read(
      "Ihre Reservierung für NH Musterstadt City, 14. Februar 2017, QXAB123456789",
      BODY
    );
    expect(r).not.toBeNull();
    expect(r?.hotelName).toBe("NH Musterstadt City");
    expect(r?.checkIn).toBe("2017-02-14");
    expect(r?.checkOut).toBe("2017-02-16");
    expect(r?.nights).toBe(2);
    expect(r?.confirmationNumber).toBe("QXAB123456789");
    expect(r?.address).toBe("Beispielweg 7");
    expect(r?.postcode).toBe("12345");
    expect(r?.city).toBe("Musterstadt");
    expect(r?.country).toBe("Deutschland");
    expect(r?.totalPrice).toBeCloseTo(192.6, 2);
    expect(r?.currency).toBe("EUR");
  });

  it("reads the confirmation whose subject names no hotel, from its body", () => {
    expect(read("Ihre Reservierung bei NH Hoteles", BODY)?.hotelName).toBe("NH Musterstadt City");
  });

  it("declines a reply asking to cancel, although it quotes the whole confirmation", () => {
    const reply = `ich bitte um kostenfreie Stornierung meiner Reservierung.\r\n\r\n${BODY}`;
    expect(
      read(
        "Re: AW: Ihre Reservierung für NH Musterstadt City, 14. Februar 2017, QXAB123456789",
        reply
      )
    ).toBeNull();
  });

  it("declines an NH newsletter", () => {
    const newsletter =
      "Entdecken Sie unsere Hotels\r\nCheck-in ab 14 Uhr — NH Hotel Group\r\nnh-hotels.com";
    expect(read("Ihre nächste Reise mit NH", newsletter)).toBeNull();
  });
});
