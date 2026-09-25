import { prisma } from "../db";
import { createCruiseSchema } from "../schemas/cruise";
import { CRUISE_TEMPLATES } from "../seedDemoAccount";

/**
 * The demo seed writes only cabin types the cruise schema accepts (board item
 * `demo-seed-writes-invalid-cabin-types`).
 *
 * It used to write German free text — "Balkon", "Außenkabine", "Star Class
 * Suite". Every seeded cruise was then unsaveable in its edit dialog (the PUT
 * answers 400 on `cabinType`, whichever field was changed), and a spreadsheet
 * round trip of a demo account refused the cruise rows. The public preview
 * runs on this seed, so its testers met both.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

describe("demo seed cabin types", () => {
  it.each(CRUISE_TEMPLATES.map((t) => [t.shipName, t.cabinType] as const))(
    "%s: %s is a value the cruise schema accepts",
    (_ship, cabinType) => {
      const parsed = createCruiseSchema.shape.cabinType.safeParse(cabinType);
      expect(parsed.success).toBe(true);
    }
  );
});
