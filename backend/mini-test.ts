import { parseBookingEmail } from './src/services/bookingParser';

const emailText = `
Von: Lufthansa Booking
An: DENNIS.WITTKE@SICOTRONIC.DE
Betreff: Vielen Dank für Ihre Buchung | von München nach Luxemburg am 18 November 2025
Datum: Montag, 10. November 2025 16:39:52

Buchungscode: 9RFAA7
Buchungsbestätigung

18.11.2025 - 11:00 1 Stopps
MUC LUX
München Luxemburg

Dauer: 2h 55m
11:00 13:55

Reiseplan
18.11.2025 - 11:00
München
Munich
Terminal 2*

18.11.2025 - 12:00
Frankfurt am Main
Frankfurt
Terminal 1*
LH103 Durchgeführt von: Lufthansa
Airbus Industrie A321*
Economy Light

1 Stop in Frankfurt 1h 05m

18.11.2025 - 13:05
Frankfurt am Main
Frankfurt
Terminal 1*

18.11.2025 - 13:55
Luxemburg
Luxembourg
LH5642 Durchgeführt von: Air Dolomiti
Embraer 190*
Economy Light

20.11.2025 - 09:30
LUX MUC
Luxemburg München
Dauer: 1h 05m
09:30 10:35

20.11.2025 - 09:30
Luxemburg
Luxembourg

20.11.2025 - 10:35
München
Munich
Terminal 2*
LH2317 Durchgeführt von: Lufthansa Cityline
Canadair Regional Jet 900*
Economy Light

Endpreis EUR 513.47
Dennis Wittke
Ticketnummer 2202236084346
`;

const subject = "Vielen Dank für Ihre Buchung | von München nach Luxemburg am 18 November 2025";

(async () => {
  const result = await parseBookingEmail(subject, emailText, undefined);
  console.log(JSON.stringify(result, null, 2));
})();
