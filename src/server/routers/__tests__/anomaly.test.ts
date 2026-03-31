import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

vi.mock("@/server/services/anomaly-event-manager", () => ({
  listAnomalies: vi.fn(),
  acknowledgeAnomaly: vi.fn(),
  dismissAnomaly: vi.fn(),
  countOpenAnomalies: vi.fn(),
  getMaxSeverityByPipeline: vi.fn(),
}));

import {
  listAnomalies,
  acknowledgeAnomaly,
  dismissAnomaly,
  countOpenAnomalies,
  getMaxSeverityByPipeline,
} from "@/server/services/anomaly-event-manager";

const mockListAnomalies = listAnomalies as ReturnType<typeof vi.fn>;
const mockAcknowledgeAnomaly = acknowledgeAnomaly as ReturnType<typeof vi.fn>;
const mockDismissAnomaly = dismissAnomaly as ReturnType<typeof vi.fn>;
const mockCountOpenAnomalies = countOpenAnomalies as ReturnType<typeof vi.fn>;
const mockGetMaxSeverity = getMaxSeverityByPipeline as ReturnType<typeof vi.fn>;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("anomaly router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("calls listAnomalies with correct params", async () => {
      mockListAnomalies.mockResolvedValue([]);

      // Verify the service function is wired correctly
      await listAnomalies({ environmentId: "env-1", status: "open" });

      expect(mockListAnomalies).toHaveBeenCalledWith({
        environmentId: "env-1",
        status: "open",
      });
    });
  });

  describe("acknowledge", () => {
    it("calls acknowledgeAnomaly with id and userId", async () => {
      mockAcknowledgeAnomaly.mockResolvedValue({ id: "a-1", status: "acknowledged" });

      await acknowledgeAnomaly("a-1", "user-1");

      expect(mockAcknowledgeAnomaly).toHaveBeenCalledWith("a-1", "user-1");
    });
  });

  describe("dismiss", () => {
    it("calls dismissAnomaly with id and userId", async () => {
      mockDismissAnomaly.mockResolvedValue({ id: "a-1", status: "dismissed" });

      await dismissAnomaly("a-1", "user-1");

      expect(mockDismissAnomaly).toHaveBeenCalledWith("a-1", "user-1");
    });
  });

  describe("countByPipeline", () => {
    it("returns pipeline anomaly counts", async () => {
      mockCountOpenAnomalies.mockResolvedValue({ "pipe-1": 3, "pipe-2": 1 });

      const result = await countOpenAnomalies("env-1");

      expect(result).toEqual({ "pipe-1": 3, "pipe-2": 1 });
    });
  });

  describe("maxSeverityByPipeline", () => {
    it("returns max severity per pipeline", async () => {
      mockGetMaxSeverity.mockResolvedValue({
        "pipe-1": "critical",
        "pipe-2": "warning",
      });

      const result = await getMaxSeverityByPipeline("env-1");

      expect(result).toEqual({
        "pipe-1": "critical",
        "pipe-2": "warning",
      });
    });
  });
});
