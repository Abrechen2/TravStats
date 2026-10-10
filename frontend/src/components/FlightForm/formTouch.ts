/**
 * Touch sizing for every text field, date, time and select inside a flight
 * form (forgejo#249): 44 px on a coarse pointer, the compact size for a mouse.
 * Follows the POINTER, not the width — the iPad check of the lodging package
 * measured inputs at 38 px on a device operated by fingers. One class on the
 * form root rather than one per input, so a field added later is covered.
 */
export const FLIGHT_FORM_TOUCH = [
  "pointer-coarse:[&_input:not([type=checkbox]):not([type=radio]):not([type=file])]:min-h-(--ts-size-touch-min)",
  "pointer-coarse:[&_select]:min-h-(--ts-size-touch-min)",
  // The field help icons size their own hit area by pointer — the shared
  // `Toggletip` (ipad-check.md, D1) — so nothing here reaches into them.
].join(" ");
