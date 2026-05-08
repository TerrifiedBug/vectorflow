// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SchemaForm } from "../schema-form";

afterEach(cleanup);

describe("SchemaForm (v2 styling)", () => {
  it("renders mono uppercase labels for fields", () => {
    const schema = {
      type: "object",
      properties: {
        endpoint: { type: "string" },
      },
      required: ["endpoint"],
    };

    const { getByText } = render(
      <SchemaForm schema={schema} values={{}} onChange={() => {}} />,
    );

    const label = getByText("Endpoint");
    // Mono uppercase 10.5px label per Phase B inspector spec
    expect(label.className).toMatch(/font-mono/);
    expect(label.className).toMatch(/uppercase/);
    expect(label.className).toMatch(/tracking-\[0\.04em\]/);
    expect(label.className).toMatch(/text-fg-2/);
  });

  it("marks required fields with a red asterisk", () => {
    const schema = {
      type: "object",
      properties: { endpoint: { type: "string" } },
      required: ["endpoint"],
    };

    const { container } = render(
      <SchemaForm schema={schema} values={{}} onChange={() => {}} />,
    );

    const asterisk = container.querySelector("span.text-status-error");
    expect(asterisk).toBeTruthy();
    expect(asterisk?.textContent).toBe("*");
  });

  it("renders empty-state copy when there are no properties", () => {
    const { getByText } = render(
      <SchemaForm
        schema={{ type: "object", properties: {} }}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(getByText("No configurable properties.")).toBeTruthy();
  });
});
