#!/usr/bin/env tsx
import { prisma } from "@/lib/prisma";
import { encryptChannelConfig, SENSITIVE_FIELDS_BY_TYPE } from "@/server/services/channel-secrets";

async function main() {
  const channels = await prisma.notificationChannel.findMany({
    select: { id: true, type: true, config: true },
  });

  let updated = 0, skipped = 0;
  for (const ch of channels) {
    if (!SENSITIVE_FIELDS_BY_TYPE[ch.type]) { skipped++; continue; }
    const config = ch.config as Record<string, unknown>;
    const encrypted = encryptChannelConfig(ch.type, config);
    // Only write if at least one field actually changed (idempotent skip)
    const changed = Object.keys(encrypted).some((k) => encrypted[k] !== config[k]);
    if (!changed) { skipped++; continue; }
    await prisma.notificationChannel.update({
      where: { id: ch.id },
      data: { config: encrypted as never },
    });
    updated++;
    console.log(`encrypted channel ${ch.id} (${ch.type})`);
  }
  console.log(`done — updated=${updated} skipped=${skipped} total=${channels.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
