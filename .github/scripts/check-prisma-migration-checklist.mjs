import fs from "node:fs";

export const PRISMA_MIGRATION_PATTERNS = [
  "prisma/schema.prisma",
  "prisma/migrations/",
];

export const REQUIRED_CHECKS = [
  "Backfill or data migration plan is documented, or confirmed not needed.",
  "Index impact is reviewed for new queries, changed filters, and high-churn tables.",
  "TimescaleDB compatibility is reviewed for hypertables, compression, continuous aggregates, and plain PostgreSQL fallback.",
  "Rollback plan is documented, including any manual SQL or data restoration steps.",
];

export function hasPrismaMigrationChanges(files) {
  return files.some((file) =>
    PRISMA_MIGRATION_PATTERNS.some((pattern) =>
      pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern,
    ),
  );
}

export function findMissingChecklistItems(body) {
  return REQUIRED_CHECKS.filter((item) => {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^- \\[[xX]\\] ${escaped}\\s*$`, "m");
    return !pattern.test(body);
  });
}

function readChangedFiles() {
  const path = process.env.CHANGED_FILES_PATH;

  if (!path) {
    throw new Error("CHANGED_FILES_PATH is required");
  }

  return fs
    .readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function readPullRequestBody() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is required");
  }

  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  return event.pull_request?.body ?? "";
}

export function validateMigrationChecklist(files, body) {
  if (!hasPrismaMigrationChanges(files)) {
    return {
      migrationChanged: false,
      missing: [],
    };
  }

  return {
    migrationChanged: true,
    missing: findMissingChecklistItems(body),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readChangedFiles();
  const body = readPullRequestBody();
  const result = validateMigrationChecklist(files, body);

  if (!result.migrationChanged) {
    console.log("No Prisma schema or migration changes detected.");
    process.exit(0);
  }

  console.log("Prisma schema or migration changes detected:");
  for (const file of files.filter((changedFile) =>
    PRISMA_MIGRATION_PATTERNS.some((pattern) =>
      pattern.endsWith("/")
        ? changedFile.startsWith(pattern)
        : changedFile === pattern,
    ),
  )) {
    console.log(`- ${file}`);
  }

  if (result.missing.length === 0) {
    console.log("Prisma migration checklist is complete.");
    process.exit(0);
  }

  console.error("Prisma migration checklist is incomplete.");
  console.error(
    "Check every item in the PR template section `Prisma migration checklist`, using the item text exactly as written.",
  );
  console.error("Missing checked items:");
  for (const item of result.missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}
