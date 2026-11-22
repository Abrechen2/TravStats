import { fireEvent, screen, waitFor, within } from "@testing-library/react";

/**
 * Tests for a ⋯ menu (`ui/OverflowMenu`): open it, then choose an entry by its accessible name.
 * Synchronous (`fireEvent`), so tests under fake timers need no extra awaiting.
 */
export function chooseMenuEntry(trigger: HTMLElement, entry: string | RegExp): void {
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: entry }));
}

/** The ⋯ trigger inside a row, card or section (a menu's trigger announces `aria-haspopup`). */
export function menuTriggerIn(scope: HTMLElement, index = 0): HTMLElement {
  const triggers = Array.from(scope.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]'));
  const found = triggers[index];
  if (!found) throw new Error(`no ⋯ menu #${index} inside the given element`);
  return found;
}

/** Row ⋯ by the row's text: finds the closest row/item holding `text` and opens its menu. */
export function chooseInRow(rowText: string | RegExp, entry: string | RegExp): void {
  const cell = screen.getAllByText(rowText)[0];
  const row = cell?.closest<HTMLElement>('tr, li, [role="row"], [data-testid]') ?? undefined;
  if (!row) throw new Error("row not found");
  chooseMenuEntry(menuTriggerIn(row), entry);
}

export { within };

/** The nth bare ⋯ on the page (rows and cards; the header "Mehr" carries text and is skipped). */
export function bareMenuTrigger(index = 0): HTMLElement {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')
  ).filter((b) => (b.textContent ?? "").trim() === "");
  const found = all[index];
  if (!found) throw new Error(`no bare ⋯ menu #${index} on the page`);
  return found;
}

/** Opens the nth bare ⋯ on the page and chooses an entry. */
export function chooseFromBareMenu(entry: string | RegExp, index = 0): void {
  chooseMenuEntry(bareMenuTrigger(index), entry);
}

/**
 * Waits until a bare ⋯ exists (rows that arrive after a fetch). Choose in a SEPARATE, synchronous
 * `chooseFromBareMenu` call: an `async` helper would yield to the microtask queue right after the
 * click and let the entry's follow-up renders land outside act().
 */
export async function bareMenuReady(index = 0): Promise<void> {
  await waitFor(() => bareMenuTrigger(index));
}

/** Opens a menu by its trigger's test id and clicks an entry by its test id. */
export function chooseByTestId(menuTestId: string, entryTestId: string): void {
  fireEvent.click(screen.getByTestId(menuTestId));
  fireEvent.click(screen.getByTestId(entryTestId));
}

/** The bare ⋯ triggers whose menu offers an entry of that name (opens and closes each to look). */
export function triggersOffering(entry: string | RegExp): HTMLElement[] {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')
  ).filter((b) => (b.textContent ?? "").trim() === "");
  return all.filter((trigger) => {
    fireEvent.click(trigger);
    const has = screen.queryByRole("menuitem", { name: entry }) !== null;
    fireEvent.click(trigger);
    return has;
  });
}
