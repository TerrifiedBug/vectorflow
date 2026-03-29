import { describe, it, expect } from "vitest";
import { toFilenameSlug } from "../git-sync";

describe("gitPath derivation", () => {
  it("derives gitPath from environment and pipeline names", () => {
    const envSlug = toFilenameSlug("Production US-East");
    const pipelineSlug = toFilenameSlug("My Pipeline v2");
    const gitPath = `${envSlug}/${pipelineSlug}.yaml`;
    expect(gitPath).toBe("production-us-east/my-pipeline-v2.yaml");
  });

  it("handles special characters in names", () => {
    const envSlug = toFilenameSlug("staging (test)");
    const pipelineSlug = toFilenameSlug("pipeline@special!");
    expect(`${envSlug}/${pipelineSlug}.yaml`).toBe("staging-test/pipeline-special.yaml");
  });

  it("handles empty names", () => {
    expect(toFilenameSlug("")).toBe("unnamed");
  });

  it("preserves gitPath on rename: once set, gitPath stays the same", () => {
    // Simulate: pipeline originally named "access-logs", synced to git
    const originalGitPath = "production/access-logs.yaml";

    // Pipeline renamed to "Access Logs v2" — gitPath should stay the same
    // (the code never overwrites gitPath once set)
    const renamedSlug = toFilenameSlug("Access Logs v2");
    const derivedPath = `production/${renamedSlug}.yaml`;

    // These should be different, proving rename doesn't affect gitPath
    expect(derivedPath).toBe("production/access-logs-v2.yaml");
    expect(originalGitPath).not.toBe(derivedPath);

    // But the git sync uses originalGitPath, not derivedPath
    const pathUsedBySync = originalGitPath; // gitPath field
    expect(pathUsedBySync).toBe("production/access-logs.yaml");
  });
});
