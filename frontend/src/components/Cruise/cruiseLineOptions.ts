import { shipsApi } from "../../lib/api";
import type { CatalogueOption } from "../FlightForm/fields/CatalogueCombobox";

/**
 * The cruise line field's suggestions, for every cruise form (create, edit,
 * import preview) so the three behave the same. Module-level so the
 * combobox's debounce effect sees one stable function. The lines carry no
 * catalogue id; the list position is only a React key.
 */
export async function searchCruiseLineOptions(q: string): Promise<CatalogueOption[]> {
  const lines = await shipsApi.cruiseLines(q);
  return lines.map((name, id) => ({ id, name, codes: [] }));
}
