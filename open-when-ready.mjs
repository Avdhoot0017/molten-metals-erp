#!/usr/bin/env node
/**
 * Opens the browser once the server is actually answering.
 *
 * Launching it the instant `npm start` is called lands on a
 * connection-refused page, which reads as "the ERP is broken" to anyone who
 * did not know a server takes a few seconds to come up. So this polls the port
 * first and only opens a window when there is something to show.
 *
 *   node open-when-ready.mjs [port]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = Number(process.argv[2]) || 3000;
const url = `http://localhost:${port}`;
const TIMEOUT_MS = 120_000;
const started = Date.now();

/** True once the server answers at all - any status counts, even a redirect. */
async function isUp() {
  try {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 2000);
    await fetch(url, { signal: controller.signal, redirect: "manual" });
    globalThis.clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

function openBrowser() {
  const cmd =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
}

while (Date.now() - started < TIMEOUT_MS) {
  if (await isUp()) {
    openBrowser();
    process.exit(0);
  }
  await sleep(1000);
}

// Giving up quietly is right here: the launcher window already shows the
// server log, so whatever went wrong is visible there rather than in a
// browser window nobody asked for.
console.error(`Server did not answer on ${url} within 2 minutes.`);
process.exit(1);
