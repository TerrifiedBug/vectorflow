import { describe, it, expect } from "vitest";
import { validateNodeConfig } from "@/lib/vector/validate-node-config";

describe("validateNodeConfig", () => {
  it("returns hasError: false when all required fields are populated", () => {
    const schema = {
      properties: {
        endpoint: { type: "string" },
        port: { type: "number" },
      },
      required: ["endpoint", "port"],
    };
    const config = { endpoint: "https://example.com", port: 8080 };

    const result = validateNodeConfig(config, schema);

    expect(result.hasError).toBe(false);
    expect(result.firstErrorMessage).toBeUndefined();
  });

  it("returns hasError: true when a required string field is empty string", () => {
    const schema = {
      properties: {
        endpoint: { type: "string" },
      },
      required: ["endpoint"],
    };
    const config = { endpoint: "" };

    const result = validateNodeConfig(config, schema);

    expect(result.hasError).toBe(true);
    expect(result.firstErrorMessage).toBe("Endpoint is required");
  });

  it("returns hasError: true when a required field is undefined", () => {
    const schema = {
      properties: {
        endpoint: { type: "string" },
      },
      required: ["endpoint"],
    };
    const config = {};

    const result = validateNodeConfig(config, schema);

    expect(result.hasError).toBe(true);
    expect(result.firstErrorMessage).toBe("Endpoint is required");
  });

  it("returns hasError: false when schema has no required array", () => {
    const schema = {
      properties: {
        endpoint: { type: "string" },
      },
    };
    const config = {};

    const result = validateNodeConfig(config, schema);

    expect(result.hasError).toBe(false);
    expect(result.firstErrorMessage).toBeUndefined();
  });

  it("returns hasError: false when schema has no properties", () => {
    const schema = {};
    const config = {};

    const result = validateNodeConfig(config, schema);

    expect(result.hasError).toBe(false);
    expect(result.firstErrorMessage).toBeUndefined();
  });

  it("returns hasError: true with URI format error when a required field with format uri has invalid value", () => {
    const schema = {
      properties: {
        endpoint: { type: "string", format: "uri" },
      },
      required: ["endpoint"],
    };
    const config = { endpoint: "not-a-url" };

    const result = validateNodeConfig(config, schema);

    expect(result.hasError).toBe(true);
    expect(result.firstErrorMessage).toBe("Must be a valid URL (e.g. https://...)");
  });

  it("returns first error alphabetically by field name when multiple required fields are missing", () => {
    const schema = {
      properties: {
        topic: { type: "string" },
        bootstrap_servers: { type: "string" },
        group_id: { type: "string" },
      },
      required: ["topic", "bootstrap_servers", "group_id"],
    };
    // All missing — alphabetical order: bootstrap_servers, group_id, topic
    const config = {};

    const result = validateNodeConfig(config, schema);

    expect(result.hasError).toBe(true);
    // "bootstrap_servers" comes first alphabetically
    expect(result.firstErrorMessage).toBe("Bootstrap Servers is required");
  });
});
