/**
 * Local demo data for the fettling screen. Fettling tables ONLY.
 *
 * Creates a few days of multi-part entries so the new popup, the per-part
 * breakdown and the preview all have something to show. It never touches
 * inventory, production, purchase orders, parts, employees or users, and it
 * skips any employee/day that already has an entry - so nothing recorded by
 * hand is overwritten.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) });

/** UTC midnight, matching how activity dates are stored. */
function dayUtc(offset: number): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

async function main() {
  const [employees, parts, recorder] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true },
      include: { activityType: true },
      orderBy: { employeeCode: "asc" },
    }),
    prisma.part.findMany({ where: { isActive: true }, orderBy: { partCode: "asc" } }),
    prisma.user.findFirst({ where: { role: "FETTLING_MANAGER" } }),
  ]);

  if (!recorder) throw new Error("No fettling manager to attribute the entries to");
  if (parts.length < 2) throw new Error("Need at least two active parts");

  console.log(`\n${employees.length} employees, ${parts.length} parts\n`);

  let created = 0;
  let skipped = 0;

  // Today, yesterday, and two days ago - so there is data in the editable
  // window AND in a locked day, to see both states
  for (const offset of [0, -1, -2]) {
    const date = dayUtc(offset);
    const label = date.toISOString().slice(0, 10);

    for (const [index, employee] of employees.entries()) {
      const existing = await prisma.fettlingActivity.findUnique({
        where: { employeeId_date: { employeeId: employee.id, date } },
      });
      if (existing) {
        skipped++;
        continue;
      }

      // Two or three parts per person, varying by day so the screen is not
      // uniform. Deterministic, so re-running gives the same shape.
      const seed = index * 7 + Math.abs(offset) * 13;
      const lineCount = (seed % 3) + 1;
      const lines = Array.from({ length: lineCount }, (_, n) => {
        const part = parts[(seed + n * 5) % parts.length];
        const done = 20 + ((seed + n * 11) % 60);
        // A few percent fail inspection
        const rejected = Math.floor((done * ((seed + n) % 6)) / 100);
        return { partId: part.id, partsCompleted: done, partsRejected: rejected };
      });

      // The same part twice in one entry is not allowed
      const unique = lines.filter(
        (l, i) => lines.findIndex((o) => o.partId === l.partId) === i
      );

      await prisma.fettlingActivity.create({
        data: {
          employeeId: employee.id,
          activityTypeId: employee.activityTypeId,
          date,
          partsCompleted: unique.reduce((s, l) => s + l.partsCompleted, 0),
          partsRejected: unique.reduce((s, l) => s + l.partsRejected, 0),
          items: { create: unique },
          notes: offset === -1 && index % 4 === 0 ? "Ran short on trolleys" : null,
          recordedBy: recorder.id,
        },
      });
      created++;
    }
    console.log(`  ${label}  done`);
  }

  console.log(`\nCreated ${created} entries, skipped ${skipped} that already existed.\n`);
}

main()
  .catch((e) => {
    console.error("\nFailed:", e.message, "\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
