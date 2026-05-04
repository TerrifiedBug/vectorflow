export interface ChannelPayload {
  alertId: string;
  status: "firing" | "resolved";
  ruleName: string;
  severity: string;
  ownerHint?: string;
  suggestedAction?: string;
  environment: string;
  team?: string;
  node?: string;
  pipeline?: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: string;
  dashboardUrl: string;
}

export interface ChannelDeliveryResult {
  channelId: string;
  success: boolean;
  error?: string;
}

export interface ChannelDriver {
  deliver(
    config: Record<string, unknown>,
    payload: ChannelPayload,
  ): Promise<ChannelDeliveryResult>;
  test(config: Record<string, unknown>): Promise<ChannelDeliveryResult>;
}
