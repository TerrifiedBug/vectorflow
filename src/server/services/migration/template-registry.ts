import type { TranslatedBlock } from "./types";

export interface MigrationTemplate {
  id: string;
  name: string;
  description: string;
  fluentdPattern: string;
  /** FluentD config example (used as few-shot example in AI prompts) */
  fluentdConfig: string;
  /** Pre-translated Vector blocks */
  vectorBlocks: TranslatedBlock[];
  /** Documentation link */
  docLink: string | null;
  tags: string[];
}

// Use a module-level array for template storage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const templates: MigrationTemplate[] = (globalThis as any).__migrationTemplates ??= [];

export function registerTemplate(template: MigrationTemplate): void {
  // Avoid duplicates on hot reload
  const existing = templates.findIndex((t) => t.id === template.id);
  if (existing !== -1) {
    templates[existing] = template;
  } else {
    templates.push(template);
  }
}

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  // Dynamic imports to avoid circular reference
  require("./templates/01-tail-elasticsearch");
  require("./templates/02-tail-kafka");
  require("./templates/03-tail-s3");
  require("./templates/04-syslog-elasticsearch");
  require("./templates/05-forward-bridge");
  require("./templates/06-http-datadog");
  require("./templates/07-kubernetes-loki");
  require("./templates/08-multi-output-fanout");
  require("./templates/09-log-parsing-enrichment");
  require("./templates/10-grep-routing");
}

export function getAllMigrationTemplates(): MigrationTemplate[] {
  ensureInitialized();
  return [...templates];
}

export function getMigrationTemplate(id: string): MigrationTemplate | undefined {
  ensureInitialized();
  return templates.find((t) => t.id === id);
}
