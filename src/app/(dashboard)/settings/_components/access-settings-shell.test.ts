import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(dashboard)/settings/_components/access-settings-shell.tsx", "utf8");

describe("AccessSettingsShell permissions copy", () => {
  it("describes editor pipeline access in canvas language", () => {
    expect(source).toContain("Create and edit pipelines on canvas");
    expect(source).not.toContain("Create and edit draft pipelines");
  });
});
