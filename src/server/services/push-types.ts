// src/server/services/push-types.ts

/**
 * Server→Agent push message types sent over SSE.
 * Each message has a `type` discriminator for client-side dispatch.
 *
 * Config changes use lightweight notifications (config_changed) that trigger
 * an immediate re-poll, rather than carrying the full assembled config.
 * This avoids duplicating secret/cert resolution logic from the config endpoint.
 */
export type PushMessage =
  | ConfigChangedMessage
  | SampleRequestMessage
  | ActionMessage
  | PollIntervalMessage
  | TapStartMessage
  | TapStopMessage;

/** Notification that pipeline config has changed. Agent should re-poll immediately. */
export interface ConfigChangedMessage {
  type: "config_changed";
  /** Optional: which pipeline changed. If absent, agent re-polls all. */
  pipelineId?: string;
  /** Reason for the change (deploy, undeploy, maintenance). For logging only. */
  reason?: string;
}

export interface SampleRequestMessage {
  type: "sample_request";
  requestId: string;
  pipelineId: string;
  componentKeys: string[];
  limit: number;
}

export interface ActionMessage {
  type: "action";
  action: "self_update" | "restart";
  targetVersion?: string;
  downloadUrl?: string;
  checksum?: string;
}

export interface PollIntervalMessage {
  type: "poll_interval";
  intervalMs: number;
}

/** Request agent to start a live tap on a component. */
export interface TapStartMessage {
  type: "tap_start";
  requestId: string;
  pipelineId: string;
  componentId: string;
}

/** Request agent to stop a live tap. */
export interface TapStopMessage {
  type: "tap_stop";
  requestId: string;
}
