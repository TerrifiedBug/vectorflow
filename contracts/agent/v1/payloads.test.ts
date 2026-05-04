import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  configResponseSchema,
  heartbeatRequestSchema,
  logBatchesRequestSchema,
  pushMessagesFixtureSchema,
  sampleResultsRequestSchema,
  tapEventPayloadSchema,
} from "./payloads";

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), "contracts/agent/v1/fixtures", name),
      "utf8",
    ),
  );
}

describe("agent v1 payload contracts", () => {
  it("validates the config response fixture", () => {
    expect(() =>
      configResponseSchema.parse(readFixture("config-response.json")),
    ).not.toThrow();
  });

  it("validates the heartbeat request fixture", () => {
    expect(() =>
      heartbeatRequestSchema.parse(readFixture("heartbeat-request.json")),
    ).not.toThrow();
  });

  it("validates the log batches fixture", () => {
    expect(() =>
      logBatchesRequestSchema.parse(readFixture("log-batches-request.json")),
    ).not.toThrow();
  });

  it("validates the sample results fixture", () => {
    expect(() =>
      sampleResultsRequestSchema.parse(readFixture("sample-results-request.json")),
    ).not.toThrow();
  });

  it("validates the tap event fixtures", () => {
    expect(() =>
      tapEventPayloadSchema.parse(readFixture("tap-event-request.json")),
    ).not.toThrow();
    expect(() =>
      tapEventPayloadSchema.parse(readFixture("tap-stopped-request.json")),
    ).not.toThrow();
  });

  it("validates the push message fixtures", () => {
    expect(() =>
      pushMessagesFixtureSchema.parse(readFixture("push-messages.json")),
    ).not.toThrow();
  });
});
