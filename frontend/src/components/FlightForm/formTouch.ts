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
  // The field help icons (shared `HelpIcon`, its button is `.cursor-help`)
  // stay 16 px; an ::after 14 px past them on every side takes the tap —
  // the lodging status tag's fix for the same 16 px target the iPad check
  // measured (ipad-check.md, D1), here for every help icon of a flight form.
  "pointer-coarse:[&_button.cursor-help]:after:absolute",
  "pointer-coarse:[&_button.cursor-help]:after:-inset-3.5",
].join(" ");
