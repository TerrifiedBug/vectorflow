#!/usr/bin/env node
/**
 * verify-audit-chain.ts
 *
 * Verify the integrity of a customer-facing audit-log export produced
 * by /api/v1/audit/export?format=chain (verifierVersion=1).
 *
 * Reads the envelope from a file path (or stdin), recomputes each row's
 * hash, and prints PASS or FAIL with a row pointer.
 *
 * Usage:
 *   pnpm tsx scripts/verify-audit-chain.ts <path-to-envelope.json>
 *   cat envelope.json | pnpm tsx scripts/verify-audit-chain.ts -
 *
 * Exit:
 *   0  chain is intact
 *   1  chain verification failed (output points at the first broken row)
 *   2  invalid invocation / unreadable input
 */

import { readFile } from "node:fs/promises";
import { verifyAuditExportEnvelope } from "../src/server/services/audit-export";

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write(
      "verify-audit-chain: missing argument; pass a path or '-' to read stdin\n",
    );
    process.exit(2);
  }

  let raw: string;
  if (arg === "-") {
    raw = await new Promise<string>((resolve, reject) => {
      let buf = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk) => (buf += chunk));
      process.stdin.on("end", () => resolve(buf));
      process.stdin.on("error", reject);
    });
  } else {
    raw = await readFile(arg, "utf-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`verify-audit-chain: invalid JSON — ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }

  const result = verifyAuditExportEnvelope(parsed);
  if (result.valid) {
    process.stdout.write("PASS: audit chain is intact\n");
    process.exit(0);
  }
  process.stdout.write(
    `FAIL: audit chain broken${
      typeof result.brokenAt === "number" ? ` at row ${result.brokenAt}` : ""
    }\n  ${result.reason ?? "no reason given"}\n`,
  );
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `verify-audit-chain: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(2);
});
