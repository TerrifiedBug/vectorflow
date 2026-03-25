import { prisma } from "@/lib/prisma";
import type { ChannelDriver, ChannelPayload, ChannelDeliveryResult } from "./types";
import { slackDriver } from "./slack";
import { emailDriver } from "./email";
import { pagerdutyDriver } from "./pagerduty";
import { webhookDriver } from "./webhook";
import { trackChannelDelivery } from "@/server/services/delivery-tracking";

export type { ChannelPayload, ChannelDeliveryResult, ChannelDriver };

const drivers: Record<string, ChannelDriver> = {
  slack: slackDriver,
  email: emailDriver,
  pagerduty: pagerdutyDriver,
  webhook: webhookDriver,
};

/**
 * Get the channel driver for a given type.
 * Throws if the type is not supported.
 */
export function getDriver(type: string): ChannelDriver {
  const driver = drivers[type];
  if (!driver) {
    throw new Error(`Unsupported notification channel type: ${type}`);
  }
  return driver;
}

/**
 * Deliver a payload to all relevant notification channels for an environment.
 *
 * If alertRuleId is provided, delivers only to channels linked via
 * AlertRuleChannel. Falls back to all enabled channels in the environment
 * if no specific channels are linked.
 *
 * When alertEventId is provided, each delivery is wrapped with delivery
 * tracking so a DeliveryAttempt record is persisted per channel.
 */
export async function deliverToChannels(
  environmentId: string,
  alertRuleId: string | null,
  payload: ChannelPayload,
  alertEventId?: string,
): Promise<ChannelDeliveryResult[]> {
  let channels: Array<{
    id: string;
    name: string;
    type: string;
    config: unknown;
  }>;

  if (alertRuleId) {
    // Find channels explicitly linked to this alert rule
    const linkedChannels = await prisma.alertRuleChannel.findMany({
      where: { alertRuleId },
      include: {
        channel: {
          select: { id: true, name: true, type: true, config: true, enabled: true },
        },
      },
    });

    if (linkedChannels.length > 0) {
      // Explicit routing exists — only use enabled linked channels.
      // If all linked channels are disabled, do NOT fall back to
      // all env channels; the user explicitly scoped this rule.
      channels = linkedChannels
        .filter((lc) => lc.channel.enabled)
        .map((lc) => lc.channel);
    } else {
      // No explicit routing — broadcast to all enabled env channels
      channels = await prisma.notificationChannel.findMany({
        where: { environmentId, enabled: true },
        select: { id: true, name: true, type: true, config: true },
      });
    }
  } else {
    // No specific rule — use all enabled channels in the environment
    channels = await prisma.notificationChannel.findMany({
      where: { environmentId, enabled: true },
      select: { id: true, name: true, type: true, config: true },
    });
  }

  const results: ChannelDeliveryResult[] = [];

  for (const channel of channels) {
    if (alertEventId) {
      // Tracked delivery: wraps each channel call with a DeliveryAttempt record
      const tracked = await trackChannelDelivery(
        alertEventId,
        channel.id,
        channel.type,
        channel.name,
        async () => {
          const driver = getDriver(channel.type);
          const result = await driver.deliver(
            channel.config as Record<string, unknown>,
            payload,
          );
          return { success: result.success, error: result.error };
        },
      );
      results.push({ channelId: channel.id, success: tracked.success, error: tracked.error });
    } else {
      // Untracked delivery (no alertEventId context)
      try {
        const driver = getDriver(channel.type);
        const result = await driver.deliver(
          channel.config as Record<string, unknown>,
          payload,
        );
        results.push({ ...result, channelId: channel.id });
      } catch (err) {
        console.error(
          `Channel delivery error (${channel.type} / ${channel.id}):`,
          err,
        );
        results.push({
          channelId: channel.id,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  }

  return results;
}
