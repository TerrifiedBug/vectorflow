/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import "vitest-axe/extend-expect";

import { LakeResultsTable, type LakeResultRow } from "../lake-results-table";

expect.extend(matchers);
afterEach(cleanup);

const ROW: LakeResultRow = {
  timestamp: "2026-06-05 12:00:00.000",
  eventType: "log",
  severity: "info",
  host: "caddy.example.com",
  source: "file",
  message: "handled request",
  traceId: "",
  raw: '{"msg":"handled request","request":{"host":"caddy.example.com"}}',
  // Intentionally unsorted to prove the detail grid sorts keys.
  attrs: { msg: "handled request", zeta: "z", alpha: "a" },
};

function renderTable(rows: LakeResultRow[] = [ROW]) {
  return render(
    <LakeResultsTable
      rows={rows}
      isLoading={false}
      isError={false}
      hasSearched
      onRetry={() => {}}
    />,
  );
}

describe("LakeResultsTable — expandable row detail", () => {
  it("renders the collapsed row without attrs or raw", () => {
    renderTable();
    expect(screen.getByText("handled request")).toBeTruthy();
    expect(screen.queryByText("Attributes")).toBeNull();
    expect(screen.queryByText("Raw")).toBeNull();
    const toggle = screen.getByRole("button", { name: /expand event details/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands to show sorted attrs + pretty-printed raw, then collapses", () => {
    renderTable();
    const toggle = screen.getByRole("button", { name: /expand event details/i });

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Attributes")).toBeTruthy();

    // attrs keys rendered in sorted order (alpha < msg < zeta)
    const keys = screen
      .getAllByText(/^(alpha|msg|zeta)$/)
      .map((el) => el.textContent);
    expect(keys).toEqual(["alpha", "msg", "zeta"]);

    // raw is pretty-printed JSON (indented, nested key expanded)
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain('"request"');
    expect(pre?.textContent).toContain('"host": "caddy.example.com"');

    // collapse hides the detail again
    fireEvent.click(toggle);
    expect(screen.queryByText("Attributes")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("falls back to verbatim raw when it is not valid JSON", () => {
    renderTable([{ ...ROW, raw: "plain syslog line, not json" }]);
    fireEvent.click(screen.getByRole("button", { name: /expand event details/i }));
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toBe("plain syslog line, not json");
  });

  it("shows an empty-attrs note when a row carries no attributes", () => {
    renderTable([{ ...ROW, attrs: {} }]);
    fireEvent.click(screen.getByRole("button", { name: /expand event details/i }));
    expect(screen.getByText("No attributes.")).toBeTruthy();
  });

  it("has no axe violations when a row is expanded", async () => {
    const { container } = renderTable();
    fireEvent.click(screen.getByRole("button", { name: /expand event details/i }));
    const results = await axe(container);
    // @ts-expect-error -- toHaveNoViolations is added by vitest-axe at runtime
    expect(results).toHaveNoViolations();
  });
});
