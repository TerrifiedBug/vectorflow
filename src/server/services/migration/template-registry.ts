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

  // Side-effect imports register templates via registerTemplate()
  import("./templates/01-tail-elasticsearch");
  import("./templates/02-tail-kafka");
  import("./templates/03-tail-s3");
  import("./templates/04-syslog-elasticsearch");
  import("./templates/05-forward-bridge");
  import("./templates/06-http-datadog");
  import("./templates/07-kubernetes-loki");
  import("./templates/08-multi-output-fanout");
  import("./templates/09-log-parsing-enrichment");
  import("./templates/10-grep-routing");
}

export function getAllMigrationTemplates(): MigrationTemplate[] {
  ensureInitialized();
  return [...templates];
}

export function getMigrationTemplate(id: string): MigrationTemplate | undefined {
  ensureInitialized();
  return templates.find((t) => t.id === id);
}
