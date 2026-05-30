import { describe, it, expect } from "vitest";
import { bufferSchema, acknowledgementsSchema } from "@/lib/vector/schemas/shared";

describe("bufferSchema (VF-187)", () => {
  it("exposes disk max_size gated on type=disk", () => {
    const { buffer } = bufferSchema();
    const props = buffer.properties as Record<string, Record<string, unknown>>;

    expect(props.max_size).toBeDefined();
    expect(props.max_size.type).toBe("number");
    expect(props.max_size.dependsOn).toEqual({ field: "type", value: "disk" });
  });

  it("gates max_events on the memory buffer type", () => {
    const { buffer } = bufferSchema();
    const props = buffer.properties as Record<string, Record<string, unknown>>;

    expect(props.max_events.dependsOn).toEqual({ field: "type", value: "memory" });
  });

  it("supports overflow as a when_full behavior", () => {
    const { buffer } = bufferSchema();
    const props = buffer.properties as Record<string, Record<string, unknown>>;

    expect(props.when_full.enum).toEqual(["block", "drop_newest", "overflow"]);
    expect(props.when_full.default).toBe("block");
  });
});

describe("acknowledgementsSchema (VF-186)", () => {
  it("exposes an enabled boolean defaulting to false", () => {
    const { acknowledgements } = acknowledgementsSchema();
    const props = acknowledgements.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(acknowledgements.type).toBe("object");
    expect(props.enabled.type).toBe("boolean");
    expect(props.enabled.default).toBe(false);
  });
});
