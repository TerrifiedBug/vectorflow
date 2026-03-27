import { describe, it, expect } from "vitest";
import { getAlertCategory } from "@/lib/alert-metrics";

describe("getAlertCategory", () => {
  describe("actionable metrics", () => {
    it("returns 'actionable' for cpu_usage (threshold metric)", () => {
      expect(getAlertCategory("cpu_usage")).toBe("actionable");
    });

    it("returns 'actionable' for memory_usage (threshold metric)", () => {
      expect(getAlertCategory("memory_usage")).toBe("actionable");
    });

    it("returns 'actionable' for disk_usage (threshold metric)", () => {
      expect(getAlertCategory("disk_usage")).toBe("actionable");
    });

    it("returns 'actionable' for error_rate (threshold metric)", () => {
      expect(getAlertCategory("error_rate")).toBe("actionable");
    });

    it("returns 'actionable' for node_unreachable (infrastructure metric)", () => {
      expect(getAlertCategory("node_unreachable")).toBe("actionable");
    });

    it("returns 'actionable' for fleet_error_rate (fleet metric)", () => {
      expect(getAlertCategory("fleet_error_rate")).toBe("actionable");
    });

    it("returns 'actionable' for fleet_throughput_drop (fleet metric)", () => {
      expect(getAlertCategory("fleet_throughput_drop")).toBe("actionable");
    });

    it("returns 'actionable' for fleet_event_volume (fleet metric)", () => {
      expect(getAlertCategory("fleet_event_volume")).toBe("actionable");
    });

    it("returns 'actionable' for node_load_imbalance (fleet metric)", () => {
      expect(getAlertCategory("node_load_imbalance")).toBe("actionable");
    });
  });

  describe("informational metrics", () => {
    it("returns 'informational' for deploy_requested (event metric)", () => {
      expect(getAlertCategory("deploy_requested")).toBe("informational");
    });

    it("returns 'informational' for deploy_completed (event metric)", () => {
      expect(getAlertCategory("deploy_completed")).toBe("informational");
    });

    it("returns 'informational' for deploy_rejected (event metric)", () => {
      expect(getAlertCategory("deploy_rejected")).toBe("informational");
    });

    it("returns 'informational' for deploy_cancelled (event metric)", () => {
      expect(getAlertCategory("deploy_cancelled")).toBe("informational");
    });

    it("returns 'informational' for new_version_available (event metric)", () => {
      expect(getAlertCategory("new_version_available")).toBe("informational");
    });

    it("returns 'informational' for scim_sync_failed (event metric)", () => {
      expect(getAlertCategory("scim_sync_failed")).toBe("informational");
    });

    // D-06: backup_failed stays informational even though it sounds actionable
    it("returns 'informational' for backup_failed (D-06: stays informational)", () => {
      expect(getAlertCategory("backup_failed")).toBe("informational");
    });

    // D-06: certificate_expiring stays informational even though it sounds actionable
    it("returns 'informational' for certificate_expiring (D-06: stays informational)", () => {
      expect(getAlertCategory("certificate_expiring")).toBe("informational");
    });

    it("returns 'informational' for node_joined (event metric)", () => {
      expect(getAlertCategory("node_joined")).toBe("informational");
    });

    it("returns 'informational' for node_left (event metric)", () => {
      expect(getAlertCategory("node_left")).toBe("informational");
    });
  });

  describe("unknown metrics", () => {
    it("returns 'actionable' for an unknown metric (defaults to actionable)", () => {
      expect(getAlertCategory("some_unknown_metric")).toBe("actionable");
    });
  });
});
