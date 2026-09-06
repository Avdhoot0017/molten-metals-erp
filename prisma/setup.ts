/**
 * First-run master data.
 *
 * This is the reference data the ERP needs before anyone can use it: one
 * account per role, the fettling operations the shop runs, the furnaces, and
 * an inventory line per material so stock can be booked against it. Nothing
 * else.
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
 *
 *   npm run db:setup -- --reset-passwords
 *       Also puts the four role accounts back to their default (or .env)
 *       passwords. Normally setup leaves an existing account alone so it can
 *       never lock anyone out - this is the way back in when nobody knows the
 *       password any more, e.g. after restoring a database onto a new machine.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { ALL_MATERIAL_TYPES } from "@/lib/ingot";
import "dotenv/config";

// Prisma 7 connects through an adapter, and .env is not loaded for us
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "\n❌ DATABASE_URL is not set.\n\n" +
      "   Copy .env.example to .env and point DATABASE_URL at your\n" +
      "   PostgreSQL database before running setup.\n"
  );
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const RESET_PASSWORDS = process.argv.includes("--reset-passwords");

/** Host and database name only - never the user or password. */
function describeConnection(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

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
 * One account per role, so every part of the plant can sign in on day one.
 *
 * Email, name and password are each overridable from the environment - a real
 * foundry wants its own addresses rather than @moltenmetals.com. Further
 * accounts are added afterwards in Settings.
 *
 * The default passwords below are simple and public, so that a new machine can
 * be handed over without a credential exchange. That only holds while they are
 * temporary: anyone who can reach the login page knows them, so setup prints a
 * warning and the accounts should be changed on first sign-in. Set
 * <KEY>_PASSWORD in .env to skip the defaults entirely.
 */
interface RoleAccount {
  /** Prefix for the <KEY>_EMAIL / <KEY>_NAME / <KEY>_PASSWORD env vars. */
  envKey: string;
  role: "ADMIN" | "PRODUCTION_MANAGER" | "FETTLING_MANAGER" | "ACCOUNTS";
  defaultEmail: string;
  defaultName: string;
  /** Used when no <KEY>_PASSWORD is set. Simple on purpose - see below. */
  defaultPassword: string;
  /** What the role reaches, printed so the accounts can be handed out. */
  covers: string;
}

const ROLE_ACCOUNTS: RoleAccount[] = [
  {
    envKey: "ADMIN",
    role: "ADMIN",
    defaultEmail: "admin@moltenmetals.com",
    defaultPassword: "admin@123",
    defaultName: "Administrator",
    covers: "Everything, including users and settings",
  },
  {
    envKey: "PRODUCTION",
    role: "PRODUCTION_MANAGER",
    defaultEmail: "production@moltenmetals.com",
    defaultPassword: "production@123",
    defaultName: "Production Manager",
    covers: "Production, parts, purchase orders, suppliers, companies",
  },
  {
    envKey: "FETTLING",
    role: "FETTLING_MANAGER",
    defaultEmail: "fettling@moltenmetals.com",
    defaultPassword: "fettling@123",
    defaultName: "Fettling Manager",
    covers: "Fettling shop, employees, inventory, production",
  },
  {
    envKey: "ACCOUNTS",
    role: "ACCOUNTS",
    defaultEmail: "accounts@moltenmetals.com",
    defaultPassword: "accounts@123",
    defaultName: "Accounts",
    covers: "Read-only across operations; owns users and settings",
  },
];

async function main() {
  console.log("\n🏭 Molten Metals ERP - master data setup");
  // Printed because the commonest cause of "my data is missing" is being
  // pointed at a different database than the one holding it
  console.log(`   Database: ${describeConnection(connectionString!)}\n`);

  // -------------------------------------------------------------- accounts

  /** Credentials to print at the end - only for accounts created just now. */
  const newLogins: Array<{
    role: string;
    covers: string;
    email: string;
    password: string;
    /** True when it is the built-in default rather than one they chose. */
    isDefault: boolean;
  }> = [];

  for (const account of ROLE_ACCOUNTS) {
    const email = (
      process.env[`${account.envKey}_EMAIL`] || account.defaultEmail
    ).trim();
    const name = (
      process.env[`${account.envKey}_NAME`] || account.defaultName
    ).trim();
    const suppliedPassword = process.env[`${account.envKey}_PASSWORD`]?.trim();

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing && !RESET_PASSWORDS) {
      // An existing account keeps its password. Re-running setup must never
      // lock someone out of their own installation.
      console.log(`👤 ${account.role.padEnd(18)} exists:  ${email} (unchanged)`);
      continue;
    }

    const password = suppliedPassword || account.defaultPassword;
    const hashed = await bcrypt.hash(password, 12);

    if (existing) {
      // --reset-passwords only: the role and active flag are restored too, so
      // an account that was disabled or demoted can still get someone back in
      await prisma.user.update({
        where: { email },
        data: { password: hashed, role: account.role, isActive: true },
      });
      console.log(`👤 ${account.role.padEnd(18)} RESET:   ${email}`);
    } else {
      await prisma.user.create({
        data: {
          email,
          password: hashed,
          name,
          role: account.role,
          isActive: true,
        },
      });
      console.log(`👤 ${account.role.padEnd(18)} created: ${email}`);
    }
    newLogins.push({
      role: account.role,
      covers: account.covers,
      email,
      password,
      isDefault: !suppliedPassword,
    });
  }

  // ------------------------------------------------------- activity types

  for (const [index, name] of ACTIVITY_TYPES.entries()) {
    await prisma.activityType.upsert({
      where: { name },
      // Only the ordering is refreshed - if someone has deactivated an
      // operation, setup should not quietly switch it back on
      update: { sortOrder: index + 1 },
      create: { name, sortOrder: index + 1, isActive: true },
    });
  }
  console.log(`\n🛠  Fettling operations ready: ${ACTIVITY_TYPES.length}`);

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

  // ------------------------------------------------------------ what is here

  // Printed so "my old data is missing" can be answered on the spot: either
  // the rows are here and something else is wrong, or this is the wrong
  // database and the data is still sitting in the other one.
  const [users, parts, suppliers, companies, employees, batches, orders, logs] =
    await Promise.all([
      prisma.user.count(),
      prisma.part.count(),
      prisma.supplier.count(),
      prisma.company.count(),
      prisma.employee.count(),
      prisma.productionRecord.count(),
      prisma.purchaseOrder.count(),
      prisma.inventoryLog.count(),
    ]);

  console.log("\n📊 What this database holds now:");
  console.log(`   users ${users} · parts ${parts} · suppliers ${suppliers} · companies ${companies}`);
  console.log(`   employees ${employees} · production batches ${batches} · purchase orders ${orders} · stock movements ${logs}`);

  if (parts === 0 && batches === 0 && orders === 0) {
    console.log("");
    console.log("   ⚠  No operational records here. If you expected existing data,");
    console.log("      DATABASE_URL is probably pointing at the wrong database -");
    console.log("      check the name at the top of this output against your backup.");
  }

  console.log("\n✅ Master data is in place.\n");

  if (newLogins.length > 0) {
    const usingDefaults = newLogins.some((l) => l.isDefault);
    const line = "─".repeat(68);
    console.log(line);
    console.log("  SIGN-IN DETAILS");
    console.log(line);
    for (const login of newLogins) {
      console.log(`  ${login.role}`);
      console.log(`      ${login.covers}`);
      console.log(`      Email:    ${login.email}`);
      console.log(`      Password: ${login.password}${login.isDefault ? "   (default)" : ""}`);
      console.log("");
    }
    console.log(line);

    if (usingDefaults) {
      // Said plainly rather than buried: a default password is only safe for
      // as long as it takes to sign in and change it
      console.log("  ⚠  The passwords marked (default) are the built-in ones.");
      console.log("     They are in the source and anyone who can reach the");
      console.log("     login page knows them. Change each account's password");
      console.log("     after the first sign-in, under Profile.");
      console.log("");
      console.log("     To set your own instead, put <ROLE>_PASSWORD in .env");
      console.log("     before running setup - see .env.example.\n");
    } else {
      console.log("  Passwords are stored hashed and cannot be read back.\n");
    }
  }

  if (newLogins.length === 0) {
    // Every account already existed, so no password here changed. Someone who
    // cannot sign in needs to be told that outright, not left guessing.
    console.log("  All four accounts already existed, so no password was changed.");
    console.log("  They still have whatever passwords they had before.\n");
    console.log("  Locked out? Put them back to the defaults with:");
    console.log("      npm run db:setup -- --reset-passwords\n");
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
