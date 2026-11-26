import { fireEvent, screen, within } from "@testing-library/react";

/** The pill of the year picker named `label` (its middle button). */
export function yearTrigger(label: string): HTMLElement {
  return within(screen.getByRole("group", { name: label })).getAllByRole("button")[1];
}

/** Opens the picker named `label` and returns the buttons of its grid. */
export function openYearGrid(label: string): HTMLElement[] {
  const trigger = yearTrigger(label);
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  const grid = screen.getAllByRole("group").find((g) => g.getAttribute("id") !== null);
  return within(grid as HTMLElement).getAllByRole("button");
}

/** Opens the picker named `label` and picks `year` from its grid. */
export function chooseYear(label: string, year: number | string): void {
  const cell = openYearGrid(label).find((b) => b.textContent?.startsWith(String(year)));
  if (!cell) throw new Error(`no year ${year} in the picker "${label}"`);
  fireEvent.click(cell);
}
