import { createPrismaClient } from "../../../prismaClient";
import { fromDbDate, toDbDate } from "../localDate";

/**
 * Child-process probe for `dbDate.probe.test.ts`: does a Postgres `DATE`
 * (OID 1082) survive the driver under this process's host zone?
 *
 * `@prisma/adapter-pg` sits on `pg`, whose default type parser turns a DATE
 * into a HOST-local midnight. If that parser were in the path, a DATE read in
 * UTC+14 would come back as the previous day's 10:00Z and every day column
 * would shift a day west of the host. Three paths are probed — a raw literal
 * read, a raw parameter round trip, and the typed model path
 * (`Document.issuedOn`) — and each reports the raw ISO it received as well as
 * the day `fromDbDate` reads, so a failure says where the shift happens.
 */

const DAY = "2027-05-02";
const USERNAME = `tm-dbdate-probe-${process.pid}`;

type Probe = { iso: string | null; day: string | null; error?: string };

function read(value: unknown): Probe {
  if (!(value instanceof Date))
    return { iso: null, day: null, error: `not a Date: ${String(value)}` };
  try {
    return { iso: value.toISOString(), day: fromDbDate(value) };
  } catch (error) {
    return { iso: value.toISOString(), day: null, error: (error as Error).message };
  }
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const [literal] = await prisma.$queryRaw<{ d: unknown }[]>`SELECT ${DAY}::date AS d`;
    const [param] = await prisma.$queryRaw<{ d: unknown }[]>`SELECT ${toDbDate(DAY)}::date AS d`;

    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({ data: { username: USERNAME, passwordHash: "x" } });
    let model: Probe;
    try {
      const doc = await prisma.document.create({
        data: {
          userId: user.id,
          storedName: "probe",
          mimetype: "application/pdf",
          sizeBytes: 1,
          sha256: "0".repeat(64),
          format: "pdf",
          issuedOn: toDbDate(DAY),
        },
      });
      const back = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      const [stored] = await prisma.$queryRaw<{ t: string }[]>`
        SELECT issued_on::text AS t FROM documents WHERE id = ${doc.id}`;
      model = {
        ...read(back.issuedOn),
        error: stored?.t === DAY ? undefined : `stored as ${stored?.t}`,
      };
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }

    process.stdout.write(
      JSON.stringify({
        hostZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        literal: read(literal.d),
        param: read(param.d),
        model,
      }) + "\n"
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});
