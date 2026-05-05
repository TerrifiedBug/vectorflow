import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  join(__dirname, "..", "page.tsx"),
  "utf8"
);

describe("AuditPage activity table", () => {
  it("omits the details preview column and opens details in the v2 drawer", () => {
    expect(pageSource).not.toContain(
      '<TableHead className="hidden lg:table-cell">Details</TableHead>'
    );
    expect(pageSource).not.toContain(
      '<TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[300px] truncate">'
    );
    expect(pageSource).toContain("AuditDetailDrawer");
    expect(pageSource).toContain("setSelectedAuditId(entry.id)");
  });
});
