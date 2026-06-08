// src/server/services/pack-seed.ts
import { prisma } from "@/lib/prisma";
import { DEFAULT_ORG_ID } from "@/lib/org-constants";
import { ALL_DLP_TEMPLATES } from "./dlp-templates";

/**
 * A curated SYSTEM pack and the system templates it groups. `templateIds`
 * are stable `Template.id`s seeded by {@link seedDlpTemplates}; each template
 * belongs to at most one pack (`Template.packId` is a single FK).
 */
interface CuratedPackDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  featured: boolean;
  templateIds: readonly string[];
}

/** Beginner-friendly intro transforms — the gentlest starting point. */
const GETTING_STARTED_TEMPLATE_IDS: readonly string[] = [
  "dlp-email-redaction",
  "dlp-json-field-removal",
];

/**
 * Everything else in the DLP catalog rolls up into the Data Protection pack.
 * Derived from {@link ALL_DLP_TEMPLATES} so a newly-added DLP template joins
 * automatically instead of silently going unbundled.
 */
const DATA_PROTECTION_TEMPLATE_IDS: readonly string[] = ALL_DLP_TEMPLATES.map(
  (t) => t.id,
).filter((id) => !GETTING_STARTED_TEMPLATE_IDS.includes(id));

const CURATED_PACKS: readonly CuratedPackDefinition[] = [
  {
    id: "pack-getting-started",
    name: "Getting Started Pack",
    description:
      "Beginner-friendly transforms to start scrubbing sensitive data — redact email addresses and drop sensitive JSON fields.",
    category: "Getting Started",
    icon: "Play",
    featured: true,
    templateIds: GETTING_STARTED_TEMPLATE_IDS,
  },
  {
    id: "pack-data-protection",
    name: "Data Protection Pack",
    description:
      "Compliance-grade DLP transforms — mask credit cards, SSNs, phone numbers, and API keys, and anonymize IPs (PCI-DSS / HIPAA / GDPR).",
    category: "Data Protection",
    icon: "Shield",
    featured: true,
    templateIds: DATA_PROTECTION_TEMPLATE_IDS,
  },
];

/**
 * Seed (upsert) the curated SYSTEM template packs and link their member
 * system templates (`Template.packId` + `Template.featured`).
 *
 * System packs live in the default org (`organizationId = DEFAULT_ORG_ID`),
 * mirroring the system templates seeded by {@link seedDlpTemplates}. Safe to
 * run on every leader-elected boot — upsert on a stable id makes it
 * idempotent — and MUST run AFTER `seedDlpTemplates` so the DLP templates
 * exist to link. The `teamId: null` filter on the link update keeps a tenant
 * template from ever being captured by a colliding id.
 */
export async function seedCuratedPacks(): Promise<void> {
  for (const pack of CURATED_PACKS) {
    await prisma.templatePack.upsert({
      where: { id: pack.id },
      create: {
        id: pack.id,
        organizationId: DEFAULT_ORG_ID,
        name: pack.name,
        description: pack.description,
        category: pack.category,
        icon: pack.icon,
        featured: pack.featured,
      },
      update: {
        name: pack.name,
        description: pack.description,
        category: pack.category,
        icon: pack.icon,
        featured: pack.featured,
      },
    });

    if (pack.templateIds.length > 0) {
      await prisma.template.updateMany({
        where: { id: { in: [...pack.templateIds] }, teamId: null },
        data: { packId: pack.id, featured: true },
      });
    }
  }
}
