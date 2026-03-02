type StatusVariant = "healthy" | "degraded" | "error" | "neutral" | "info";

export function nodeStatusVariant(status: string): StatusVariant {
  switch (status) {
    case "HEALTHY":
    case "healthy":
      return "healthy";
    case "DEGRADED":
    case "degraded":
      return "degraded";
    case "UNREACHABLE":
    case "unreachable":
    case "CRASHED":
      return "error";
    default:
      return "neutral";
  }
}

export function pipelineStatusVariant(status: string): StatusVariant {
  switch (status) {
    case "RUNNING":
      return "healthy";
    case "STARTING":
    case "PENDING":
      return "info";
    case "CRASHED":
      return "error";
    case "STOPPED":
      return "neutral";
    default:
      return "neutral";
  }
}

export function pipelineStatusLabel(status: string): string {
  switch (status) {
    case "RUNNING": return "Running";
    case "STARTING": return "Starting";
    case "STOPPED": return "Stopped";
    case "CRASHED": return "Crashed";
    case "PENDING": return "Pending";
    default: return status;
  }
}

export function nodeStatusLabel(status: string): string {
  switch (status) {
    case "HEALTHY": return "Healthy";
    case "DEGRADED": return "Degraded";
    case "UNREACHABLE": return "Unreachable";
    case "UNKNOWN": return "Unknown";
    default: return status;
  }
}
