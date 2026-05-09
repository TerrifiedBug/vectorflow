import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(dashboard)/settings/_components/backup-settings.tsx", "utf8");

describe("BackupSettings orphaned backup UX", () => {
  it("explains orphaned backup records on the status badge", () => {
    expect(source).toContain('title="Backing file was removed from storage"');
  });

  it("visually separates the storage save action from backend controls", () => {
    expect(source).toContain('className="border-t border-line pt-4"');
    expect(source.indexOf('className="border-t border-line pt-4"')).toBeLessThan(
      source.indexOf("Save Storage Settings")
    );
  });
});
