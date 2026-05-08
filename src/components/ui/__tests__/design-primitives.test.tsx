// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SidebarProvider, SidebarGroupLabel } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { MetricChart } from "@/components/ui/metric-chart";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readFileSync } from "node:fs";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

afterEach(cleanup);

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("v2 design primitives", () => {
  it("defines runtime font variables so body text resolves to Inter", () => {
    const css = readFileSync("src/app/globals.css", "utf8");

    const rootBlockMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
    const rootBlock = rootBlockMatch?.[1] ?? "";
    expect(rootBlock).toMatch(/--font-sans:\s*var\(--font-inter\)/);
    expect(rootBlock).toMatch(/--font-mono:\s*var\(--font-jetbrains-mono\)/);
    expect(css).toMatch(/body\s*\{[\s\S]*font-family:\s*var\(--font-inter\)/);
    expect(css).toMatch(/\.text-sm\s*\{\s*font-size:\s*12px !important;/);
  });

  it("keeps sidebar labels above the text-size floor", () => {
    const { getByText } = render(
      <SidebarProvider>
        <SidebarGroupLabel>Observe</SidebarGroupLabel>
      </SidebarProvider>,
    );

    expect(getByText("Observe")).toHaveClass("text-[11px]");
    expect(getByText("Observe").className).not.toContain("text-[9px]");
  });

  it("keeps badge text at the v2 readable floor", () => {
    const { getByText } = render(<Badge size="sm">prod</Badge>);

    expect(getByText("prod")).toHaveClass("text-[11px]");
    expect(getByText("prod").className).not.toContain("text-[9px]");
  });

  it("renders chart axis labels in mono at the readable floor", () => {
    const { container } = render(
      <MetricChart
        width={240}
        height={120}
        series={[{ color: "var(--chart-1)", data: [1, 2, 3] }]}
        xLabels={["00:00", "01:00", "02:00"]}
      />,
    );

    const labels = Array.from(container.querySelectorAll("text"));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.getAttribute("font-family") === "var(--font-mono)")).toBe(true);
    expect(labels.every((label) => Number(label.getAttribute("font-size")) >= 11)).toBe(true);
  });

  it("keeps shared cards on the v2 12px body scale", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Runtime</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );

    expect(document.querySelector("[data-slot='card']")).toHaveClass("text-[12px]");
    expect(document.querySelector("[data-slot='card-content']")).toHaveClass("text-[12px]");
  });

  it("keeps select controls compact and 12px by default", () => {
    render(
      <Select defaultValue="all" defaultOpen>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All pipelines</SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(document.querySelector("[data-slot='select-trigger']")).toHaveClass("h-[34px]", "text-[12px]");
    expect(document.querySelector("[data-slot='select-item']")).toHaveClass("text-[12px]");
  });

  it("keeps tab panels content-sized so long pages can scroll", () => {
    const tabsSource = readFileSync("src/components/ui/tabs.tsx", "utf8");
    expect(tabsSource).not.toContain('className={cn("flex-1 outline-none", className)}');
  });

  it("keeps dialog content radius within the v2 shape system", () => {
    render(
      <Dialog open>
        <DialogContent forceMount>Body</DialogContent>
      </Dialog>,
    );
    const content = document.body.querySelector("[data-slot='dialog-content']");

    expect(content).toHaveClass("rounded-[3px]");
    expect(content?.className).not.toContain("rounded-lg");
  });
});
