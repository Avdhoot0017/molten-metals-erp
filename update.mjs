#!/usr/bin/env node
/**
 * Update and run: pull, migrate, build, start.
 *
 * The same job as deploy.sh, written in Node so it runs on Windows
 * without Git Bash or WSL. The differences are deliberate:
 *
 *   - it always runs, rather than exiting early when already up to date
 *   - it starts the server in the FOREGROUND, so the person who ran it sees
 *     the log and stops it with Ctrl-C. deploy.sh backgrounds the server and
 *     health-checks it, which is what you want on a machine nobody is sat at.
 *
 * It never seeds. Demo data is `npm run db:seed`, which wipes the operational
 * tables, and no update script should be able to do that by accident.
 *
 *   npm run update                 pull, migrate, build, start
 *   npm run update -- --no-start   stop after the build
 *   npm run update -- --no-pull    local code, just migrate/build/start
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(fileURLToPath(import.meta.url));
const BRANCH = process.env.BRANCH || "main";
const PORT = process.env.PORT || "3000";

const args = process.argv.slice(2);
const noStart = args.includes("--no-start");
const noPull = args.includes("--no-pull");

// Colour only when a person is watching; a redirected log stays plain text
const tty = process.stdout.isTTY;
const c = {
  bold: tty ? "\x1b[1m" : "",
  dim: tty ? "\x1b[2m" : "",
  red: tty ? "\x1b[31m" : "",
  green: tty ? "\x1b[32m" : "",
  yellow: tty ? "\x1b[33m" : "",
  blue: tty ? "\x1b[34m" : "",
  off: tty ? "\x1b[0m" : "",
};

const step = (msg) => console.log(`\n${c.blue}==>${c.off} ${c.bold}${msg}${c.off}`);
const info = (msg) => console.log(`    ${msg}`);
const ok = (msg) => console.log(`    ${c.green}✓${c.off} ${msg}`);
const warn = (msg) => console.log(`    ${c.yellow}!${c.off} ${msg}`);

function fail(msg) {
  console.error(`\n${c.red}✗ ${msg}${c.off}\n`);
  process.exit(1);
}

/** Runs a command, streaming its output. Returns the exit code. */
function run(cmd, cmdArgs) {
  // shell:true so `npm`/`npx` resolve to npm.cmd and npx.cmd on Windows
  const result = spawnSync(cmd, cmdArgs, {
    cwd: REPO,
    stdio: "inherit",
    shell: true,
  });
  return result.status ?? 1;
}

/** Runs a command quietly and returns its trimmed stdout, or null on failure. */
function capture(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: REPO,
    encoding: "utf8",
    shell: true,
  });
  if (result.status !== 0) return null;
  return (result.stdout || "").trim();
}

// ------------------------------------------------------------------ start

console.log(
  `\n${c.bold}Molten Metals ERP${c.off} - update  ${c.dim}branch=${BRANCH} port=${PORT}${c.off}`
);

if (!existsSync(join(REPO, "package.json"))) {
  fail(`No package.json in ${REPO}`);
}
if (!existsSync(join(REPO, ".env"))) {
  warn(".env not found - copy .env.example to .env and fill it in first");
}

// -------------------------------------------------------------------- pull

const headBefore = capture("git", ["rev-parse", "HEAD"]);
let skipPull = false;

if (noPull) {
  step("Skipping pull (--no-pull)");
} else if (capture("git", ["remote", "get-url", "origin"]) === null) {
  step("Skipping pull");
  warn("No 'origin' remote is configured - using the code already on disk");
} else {
  step(`Pulling ${BRANCH}`);

  // Uncommitted work would be buried by a pull, so the pull is skipped - but
  // the ERP still starts. This runs from a desktop icon on the shop floor, and
  // refusing to start the plant's system over a stray file is the wrong call:
  // skipping the pull protects that work just as well as stopping does.
  const dirty = capture("git", ["status", "--porcelain"]);
  if (dirty) {
    warn("There are uncommitted changes here, so the pull was skipped:");
    for (const line of dirty.split("\n").slice(0, 10)) info(`    ${line}`);
    warn("Starting with the code already on this machine.");
    skipPull = true;
  }

  // A machine with no network must still be able to start the ERP, so a
  // failed fetch is a loud warning rather than the end of the run. Anything
  // that fails AFTER this point - a migration, a build - does stop it, because
  // carrying on would mean running something broken.
  if (skipPull) {
    // already reported above
  } else if (run("git", ["fetch", "--prune", "origin", BRANCH]) !== 0) {
    warn("Could not reach the remote - no network, or no access to it.");
    warn("Carrying on with the code already on this machine.");
  } else {
    // Fast-forward only: an update should never invent a merge commit
    if (run("git", ["merge", "--ff-only", `origin/${BRANCH}`]) !== 0) {
      fail(
        `Cannot fast-forward to origin/${BRANCH} - the local branch has diverged.\n` +
          "  Someone needs to reconcile them by hand."
      );
    }

    const headAfter = capture("git", ["rev-parse", "HEAD"]);
    if (headAfter === headBefore) {
      ok(`Already at ${headBefore?.slice(0, 8)} - no new commits`);
    } else {
      ok(`Updated ${headBefore?.slice(0, 8)} -> ${headAfter?.slice(0, 8)}`);
    }
  }
}

// ------------------------------------------------------------ dependencies

step("Installing dependencies");
if (run("npm", ["install", "--no-audit", "--no-fund"]) !== 0) {
  fail("npm install failed.");
}
ok("Dependencies are up to date");

// -------------------------------------------------------------- migrations

step("Checking for pending migrations");

const migrationsDir = join(REPO, "prisma", "migrations");
const hasMigrations =
  existsSync(migrationsDir) &&
  readdirSync(migrationsDir, { withFileTypes: true }).some((e) => e.isDirectory());

if (!hasMigrations) {
  // A release can contain no schema change at all, and a checkout may not have
  // the folder yet. Neither is a failure.
  warn("No migrations found - the schema is assumed to be current");
} else {
  // `migrate status` exits non-zero when something is outstanding, so its exit
  // code is the check. It is only ever used to decide whether to say "applying"
  // or "already current" - `migrate deploy` is safe either way.
  const status = spawnSync("npx", ["prisma", "migrate", "status"], {
    cwd: REPO,
    encoding: "utf8",
    shell: true,
  });
  const output = `${status.stdout || ""}${status.stderr || ""}`;
  const pending = status.status !== 0 || /not yet been applied/i.test(output);

  if (pending) {
    info("Pending migrations found - applying them");
  } else {
    info("Database already matches the schema - nothing to apply");
  }

  // Always run deploy: it applies what is outstanding and exits cleanly when
  // there is nothing to do. Never `migrate dev`, which prompts and offers to
  // reset the database.
  if (run("npx", ["prisma", "migrate", "deploy"]) !== 0) {
    fail(
      "Migration failed. Nothing was built and the app was not started.\n" +
        "  Check the database connection, then `npx prisma migrate status`."
    );
  }
  ok("Database schema is up to date");
}

step("Generating the Prisma client");
// Always regenerated: the client is derived from schema.prisma, and a stale one
// fails at runtime with confusing "Unknown argument" errors rather than at build
if (run("npx", ["prisma", "generate"]) !== 0) {
  fail("prisma generate failed.");
}

// ------------------------------------------------------------------- build

step("Building");
if (run("npm", ["run", "build"]) !== 0) {
  fail("Build failed. The app was not started.");
}
ok("Build succeeded");

// ------------------------------------------------------------------- start

if (noStart) {
  step("Skipping start (--no-start)");
  console.log(`\n${c.green}${c.bold}✓ Ready. Run 'npm start' when you want it up.${c.off}\n`);
  process.exit(0);
}

step(`Starting on port ${PORT}`);
console.log(`${c.dim}    Press Ctrl-C to stop.${c.off}\n`);

// Foreground on purpose: whoever ran this sees the server log, and stopping it
// is Ctrl-C rather than hunting for a pid
const server = run("npm", ["start", "--", "-p", PORT]);
process.exit(server);
