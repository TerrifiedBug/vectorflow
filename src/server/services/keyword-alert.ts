import { prisma } from "@/lib/prisma";
import type { LogLevel } from "@/generated/prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

interface KeywordRule {
  id: string;
  keyword: string;
  severityFilter: LogLevel | null;
  windowMinutes: number;
  condition: string;
  threshold: number;
  cooldownMinutes: number;
  pipelineId: string | null;
  environmentId: string;
}

interface WindowCounter {
  count: number;
  windowStart: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
const SEVERITY_ORDER: Record<string, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};

const GLOBAL_KEY = "__global__";

// ─── State ──────────────────────────────────────────────────────────────────

let ruleCache = new Map<string, KeywordRule[]>();
let ruleCacheTimestamp = 0;
const windowCounters = new Map<string, WindowCounter>();

// ─── Exported helpers ───────────────────────────────────────────────────────

export function matchesKeyword(message: string, keyword: string): boolean {
  return message.toLowerCase().includes(keyword.toLowerCase());
}

export function severityAtOrAbove(level: string, minLevel: string): boolean {
  const levelOrder = SEVERITY_ORDER[level] ?? 0;
  const minOrder = SEVERITY_ORDER[minLevel] ?? 0;
  return levelOrder >= minOrder;
}

// ─── Rule cache ─────────────────────────────────────────────────────────────

export async function refreshKeywordRuleCache(): Promise<void> {
  const rules = await prisma.alertRule.findMany({
    where: {
      metric: "log_keyword",
      enabled: true,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
    },
    select: {
      id: true,
      keyword: true,
      keywordSeverityFilter: true,
      keywordWindowMinutes: true,
      condition: true,
      threshold: true,
      cooldownMinutes: true,
      pipelineId: true,
      environmentId: true,
    },
  });

  const newCache = new Map<string, KeywordRule[]>();

  for (const rule of rules) {
    if (!rule.keyword) continue;
    const key = rule.pipelineId ?? GLOBAL_KEY;
    const entry: KeywordRule = {
      id: rule.id,
      keyword: rule.keyword,
      severityFilter: rule.keywordSeverityFilter,
      windowMinutes: rule.keywordWindowMinutes ?? 5,
      condition: rule.condition ?? "gt",
      threshold: rule.threshold ?? 1,
      cooldownMinutes: rule.cooldownMinutes ?? 15,
      pipelineId: rule.pipelineId,
      environmentId: rule.environmentId,
    };
    const existing = newCache.get(key) ?? [];
    existing.push(entry);
    newCache.set(key, existing);
  }

  ruleCache = newCache;
  ruleCacheTimestamp = Date.now();
}

export function getKeywordRules(pipelineId: string): KeywordRule[] {
  const pipelineRules = ruleCache.get(pipelineId) ?? [];
  const globalRules = ruleCache.get(GLOBAL_KEY) ?? [];
  return [...pipelineRules, ...globalRules];
}

// ─── Matching ───────────────────────────────────────────────────────────────

export async function checkKeywordMatches(
  pipelineId: string,
  lines: Array<{ message: string; level: LogLevel | string }>,
): Promise<void> {
  if (Date.now() - ruleCacheTimestamp > CACHE_TTL_MS) {
    await refreshKeywordRuleCache();
  }

  const rules = getKeywordRules(pipelineId);
  if (rules.length === 0) return;

  const now = Date.now();

  for (const rule of rules) {
    let matchCount = 0;

    for (const line of lines) {
      if (rule.severityFilter && !severityAtOrAbove(line.level, rule.severityFilter)) {
        continue;
      }
      if (matchesKeyword(line.message, rule.keyword)) {
        matchCount++;
      }
    }

    if (matchCount === 0) continue;

    const windowMs = rule.windowMinutes * 60_000;
    const counter = windowCounters.get(rule.id);

    if (counter && now - counter.windowStart < windowMs) {
      counter.count += matchCount;
    } else {
      windowCounters.set(rule.id, { count: matchCount, windowStart: now });
    }

    const currentCounter = windowCounters.get(rule.id)!;

    const thresholdExceeded =
      rule.condition === "gt"
        ? currentCounter.count > rule.threshold
        : rule.condition === "eq"
          ? currentCounter.count === rule.threshold
          : rule.condition === "lt"
            ? currentCounter.count < rule.threshold
            : false;

    if (!thresholdExceeded) continue;

    const existingEvent = await prisma.alertEvent.findFirst({
      where: {
        alertRuleId: rule.id,
        status: { in: ["firing", "acknowledged"] },
        resolvedAt: null,
      },
      orderBy: { firedAt: "desc" },
    });

    if (existingEvent) continue;

    await prisma.alertEvent.create({
      data: {
        alertRuleId: rule.id,
        status: "firing",
        value: currentCounter.count,
        message: `Log keyword "${rule.keyword}" matched ${currentCounter.count} times in ${rule.windowMinutes} min`,
      },
    });

    windowCounters.delete(rule.id);
  }
}

// ─── Testing helper ─────────────────────────────────────────────────────────

export function _resetForTesting(): void {
  ruleCache = new Map();
  ruleCacheTimestamp = 0;
  windowCounters.clear();
}
