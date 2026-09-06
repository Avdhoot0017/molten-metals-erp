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
    "\n❌ DATABASE_URL is not set.\n\n" +
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
 * One account per role, so every part of the plant can sign in on day one.
 *
 * Each is overridable from the environment - a real foundry wants its own
 * addresses rather than @moltenmetals.com - and each gets its own generated
 * password when none is supplied. Further accounts are added in Settings.
 */
interface RoleAccount {
  /** Prefix for the <KEY>_EMAIL / <KEY>_NAME / <KEY>_PASSWORD env vars. */
  envKey: string;
  role: "ADMIN" | "PRODUCTION_MANAGER" | "FETTLING_MANAGER" | "ACCOUNTS";
  defaultEmail: string;
  defaultName: string;
  /** What the role reaches, printed so the accounts can be handed out. */
  covers: string;
}

const ROLE_ACCOUNTS: RoleAccount[] = [
  {
    envKey: "ADMIN",
    role: "ADMIN",
    defaultEmail: "admin@moltenmetals.com",
    defaultName: "Administrator",
    covers: "Everything, including users and settings",
  },
  {
    envKey: "PRODUCTION",
    role: "PRODUCTION_MANAGER",
    defaultEmail: "production@moltenmetals.com",
    defaultName: "Production Manager",
    covers: "Production, parts, purchase orders, suppliers, companies",
  },
  {
    envKey: "FETTLING",
    role: "FETTLING_MANAGER",
    defaultEmail: "fettling@moltenmetals.com",
    defaultName: "Fettling Manager",
    covers: "Fettling shop, employees, inventory, production",
  },
  {
    envKey: "ACCOUNTS",
    role: "ACCOUNTS",
    defaultEmail: "accounts@moltenmetals.com",
    defaultName: "Accounts",
    covers: "Read-only across operations; owns users and settings",
  },
];

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

  // -------------------------------------------------------------- accounts

  /** Credentials to print at the end - only for accounts created just now. */
  const newLogins: Array<{
    role: string;
    covers: string;
    email: string;
    password: string;
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

    if (existing) {
      // An existing account keeps its password. Re-running setup must never
      // lock someone out of their own installation.
      console.log(`👤 ${account.role.padEnd(18)} exists:  ${email} (unchanged)`);
      continue;
    }

    const password = suppliedPassword || generatePassword();

    await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 12),
        name,
        role: account.role,
        isActive: true,
      },
    });

    console.log(`👤 ${account.role.padEnd(18)} created: ${email}`);
    newLogins.push({
      role: account.role,
      covers: account.covers,
      email,
      // A password the operator chose is already theirs to know; only the
      // generated ones need printing
      password: suppliedPassword ? "(the one you supplied)" : password,
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

  console.log("\n✅ Master data is in place.\n");

  if (newLogins.length > 0) {
    const line = "─".repeat(68);
    console.log(line);
    console.log("  SIGN-IN DETAILS - SHOWN ONCE, NOT RECOVERABLE LATER");
    console.log(line);
    for (const login of newLogins) {
      console.log(`  ${login.role}`);
      console.log(`      ${login.covers}`);
      console.log(`      Email:    ${login.email}`);
      console.log(`      Password: ${login.password}`);
      console.log("");
    }
    console.log(line);
    console.log("  Write these down and hand them out, then have each person");
    console.log("  change their own password after signing in.");
    console.log("  Passwords are stored hashed and cannot be read back.\n");
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
