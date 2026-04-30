import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  join(__dirname, "..", "page.tsx"),
  "utf8"
);

describe("AuditPage activity table", () => {
  it("omits the details preview column while keeping expanded details", () => {
    expect(pageSource).not.toContain(
      '<TableHead className="hidden lg:table-cell">Details</TableHead>'
    );
    expect(pageSource).not.toContain(
      '<TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[300px] truncate">'
    );
    expect(pageSource).toContain(
      '<p className="text-xs font-medium text-muted-foreground mb-2">Details</p>'
    );
  });
});
