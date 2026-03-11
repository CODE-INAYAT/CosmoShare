#!/usr/bin/env node
/**
 * Deploy signaling worker to all (or selected) Cloudflare accounts in one shot.
 *
 * Usage:
 *   node deploy-all.mjs                     # Deploy to ALL 10 accounts
 *   node deploy-all.mjs signal2 signal5     # Deploy to specific workers only
 *   node deploy-all.mjs --dry-run           # Show what would happen without deploying
 *   node deploy-all.mjs --dry-run signal3   # Dry-run for specific worker
 *
 * Prerequisites:
 *   1. Fill in accountId + apiToken for each account in accounts.json
 *      - accountId: Cloudflare dashboard → Workers & Pages → Account ID (right sidebar)
 *      - apiToken:  Cloudflare dashboard → My Profile → API Tokens → Create Token
 *                   Use the "Edit Cloudflare Workers" template
 *   2. npm i -g wrangler   (or use npx — the script detects both)
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Resolve paths ──────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_PATH = join(__dirname, "accounts.json");
const WRANGLER_DIR = __dirname; // wrangler.toml lives here

// ── Parse CLI flags ────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetNames = args.filter((a) => !a.startsWith("--"));

// ── Load accounts config ───────────────────────────────────────
let accounts;
try {
  accounts = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf-8"));
} catch (e) {
  console.error("❌ Failed to read accounts.json:", e.message);
  process.exit(1);
}

// Filter to requested workers if specified
if (targetNames.length > 0) {
  const valid = new Set(accounts.map((a) => a.name));
  for (const t of targetNames) {
    if (!valid.has(t)) {
      console.error(
        `❌ Unknown worker "${t}". Available: ${[...valid].join(", ")}`
      );
      process.exit(1);
    }
  }
  accounts = accounts.filter((a) => targetNames.includes(a.name));
}

// ── Validate ───────────────────────────────────────────────────
const missing = accounts.filter((a) => !a.accountId || !a.apiToken);
if (missing.length > 0) {
  console.error("❌ Missing accountId or apiToken for:");
  missing.forEach((a) => console.error(`   • ${a.name} (${a.subdomain})`));
  console.error(
    "\nFill them in accounts.json first. See instructions at top of this script."
  );
  process.exit(1);
}

// ── Detect wrangler command ────────────────────────────────────
let wranglerCmd = "npx wrangler";
try {
  execSync("wrangler --version", { stdio: "ignore" });
  wranglerCmd = "wrangler";
} catch {
  // Fall back to npx
}

// ── Deploy loop ────────────────────────────────────────────────
console.log(
  `\n🚀 Deploying to ${accounts.length} worker(s)${
    dryRun ? " (DRY RUN)" : ""
  }...\n`
);

const results = [];
const startTime = Date.now();

for (const account of accounts) {
  const label = `${account.name} → ${account.subdomain}.workers.dev`;
  process.stdout.write(`  ⏳ ${label} ... `);

  if (dryRun) {
    console.log("SKIPPED (dry run)");
    results.push({ ...account, ok: true, dry: true });
    continue;
  }

  try {
    const t0 = Date.now();
    execSync(`${wranglerCmd} deploy --name ${account.name}`, {
      cwd: WRANGLER_DIR,
      stdio: "pipe",
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: account.accountId,
        CLOUDFLARE_API_TOKEN: account.apiToken,
      },
      timeout: 120_000, // 2 min per deploy
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✅ (${elapsed}s)`);
    results.push({ ...account, ok: true, elapsed });
  } catch (e) {
    const stderr = e.stderr?.toString()?.trim() || e.message;
    console.log("❌ FAILED");
    console.error(`     ${stderr.split("\n")[0]}\n`);
    results.push({ ...account, ok: false, error: stderr.split("\n")[0] });
  }
}

// ── Summary ────────────────────────────────────────────────────
const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
const succeeded = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

console.log("\n" + "─".repeat(60));
console.log(
  `  ✅ ${succeeded.length} succeeded   ❌ ${failed.length} failed   ⏱️  ${totalTime}s total`
);

if (failed.length > 0) {
  console.log("\n  Failed workers:");
  failed.forEach((r) => console.log(`    • ${r.name}: ${r.error}`));
}

console.log("");
process.exit(failed.length > 0 ? 1 : 0);
