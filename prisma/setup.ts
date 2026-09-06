/**
 * First-run master data.
 *
 * This is the reference data the ERP needs before anyone can use it: an
 * administrator to sign in as, the fettling operations the shop runs, the
 * furnaces, and an inventory line per material so stock can be booked against
 * it. Nothing else.
 *
 * Deliberately NOT here: parts, suppliers, companies, employees, purchase
 * orders, production batches, stock quantities. Those are the foundry's own
 * records, and inventing plausible-looking ones on a real installation is
 * worse than an empty screen - demo figures that nobody remembers are fake
 * end up being read as real.
 *
 * Safe to re-run: every write is an upsert and nothing is ever deleted, so an
 * existing installation keeps its data. `prisma/seed.ts` is the opposite - it
 * clears the operational tables and fills them with demo data. Never run that
 * on a real installation.
 *
 *   npm run db:setup      just this file
 *   npm run setup         migrate + generate + this file
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { ALL_MATERIAL_TYPES } from "@/lib/ingot";
import "dotenv/config";

// Prisma 7 connects through an adapter, and .env is not loaded for us
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "\n\u274c DATABASE_URL is not set.\n\n" +
      "   Copy .env.example to .env and point DATABASE_URL at your\n" +
      "   PostgreSQL database before running setup.\n"
  );
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** Fettling shop operations. Editable afterwards in Settings. */
const ACTIVITY_TYPES = [
  "Riser Cutting",
  "Belt Sander",
  "Manual Filing",
  "Leak Testing",
  "Welding",
];

/** Melting furnaces (bhatti). Editable afterwards in Settings. */
const FURNACES = ["Furnace 1", "Furnace 2"];

/**
 * A password nobody has to think of, for when none was supplied.
 *
 * Generated rather than defaulted to something like "admin123": this file runs
 * on real machines, and a known password shipped in a repo is a way in for
 * anyone who can reach the login page. It is printed once, at the end.
 */
function generatePassword(): string {
  // Ambiguous characters left out so it survives being read off a screen
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function main() {
  console.log("\n🏭 Molten Metals ERP - master data setup\n");

  // ---------------------------------------------------------------- admin

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@moltenmetals.com").trim();
  const suppliedPassword = process.env.ADMIN_PASSWORD?.trim();
  const adminName = (process.env.ADMIN_NAME || "Administrator").trim();

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  let generatedPassword: string | null = null;

  if (existingAdmin) {
    // An existing account keeps its password. Re-running setup must never
    // lock someone out of their own installation.
    console.log(`👤 Administrator already exists: ${adminEmail} (unchanged)`);
  } else {
    const password = suppliedPassword || generatePassword();
    if (!suppliedPassword) generatedPassword = password;

    await prisma.user.create({
      data: {
        email: adminEmail,
        password: await bcrypt.hash(password, 12),
        name: adminName,
        role: "ADMIN",
        isActive: true,
      },
    });
    console.log(`👤 Created administrator: ${adminEmail}`);
  }

  // ------------------------------------------------------- activity types

  let activityCount = 0;
  for (const [index, name] of ACTIVITY_TYPES.entries()) {
    await prisma.activityType.upsert({
      where: { name },
      // Only the ordering is refreshed - if someone has deactivated an
      // operation, setup should not quietly switch it back on
      update: { sortOrder: index + 1 },
      create: { name, sortOrder: index + 1, isActive: true },
    });
    activityCount++;
  }
  console.log(`🛠  Fettling operations ready: ${activityCount}`);

  // -------------------------------------------------------------- furnaces

  for (const name of FURNACES) {
    await prisma.furnace.upsert({
      where: { name },
      update: {},
      create: { name, isActive: true },
    });
  }
  console.log(`🔥 Furnaces ready: ${FURNACES.length}`);

  // ------------------------------------------------------- material lines

  // One line per grade-and-form, all at zero. Opening stock is entered through
  // Inventory, or arrives on a delivered purchase order - it is the foundry's
  // figure, not something setup should invent.
  for (const type of ALL_MATERIAL_TYPES) {
    await prisma.inventory.upsert({
      where: { type },
      // An existing line keeps its quantity - setup must never zero real stock
      update: {},
      create: { type, quantity: 0 },
    });
  }
  console.log(`📦 Material stock lines ready: ${ALL_MATERIAL_TYPES.length}`);

  // ----------------------------------------------------------------- done

  console.log("\n✅ Master data is in place.\n");

  if (generatedPassword) {
    const line = "─".repeat(52);
    console.log(line);
    console.log("  SIGN IN WITH THESE DETAILS - SHOWN ONCE");
    console.log(line);
    console.log(`  Email:    ${adminEmail}`);
    console.log(`  Password: ${generatedPassword}`);
    console.log(line);
    console.log("  Write this down, then change it after signing in.");
    console.log("  It is not stored anywhere in readable form.\n");
  } else if (!existingAdmin) {
    console.log(`  Sign in as ${adminEmail} with the password you supplied.\n`);
  }

  console.log("Next: enter your parts, suppliers, companies and employees,");
  console.log("then set opening stock on the Inventory page.\n");
}

main()
  .catch((error) => {
    console.error("\n❌ Setup failed:\n", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
