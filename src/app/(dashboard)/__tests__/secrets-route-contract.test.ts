import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("secrets consolidation routes", () => {
  it("adds a dedicated dashboard secrets route and redirects settings secrets there", () => {
    expect(existsSync("src/app/(dashboard)/secrets/page.tsx")).toBe(true);

    const settingsSecretsSource = readFileSync("src/app/(dashboard)/settings/secrets/page.tsx", "utf8");
    expect(settingsSecretsSource).toContain('from "next/navigation"');
    expect(settingsSecretsSource).toContain('redirect("/secrets")');
  });

  it("hosts the shared vault UI with unified secret and certificate flows", () => {
    expect(existsSync("src/components/secrets/secrets-vault-page.tsx")).toBe(true);

    const vaultSource = readFileSync("src/components/secrets/secrets-vault-page.tsx", "utf8");
    expect(vaultSource).toContain("trpc.secret.create.mutationOptions");
    expect(vaultSource).toContain("trpc.secret.update.mutationOptions");
    expect(vaultSource).toContain("trpc.secret.delete.mutationOptions");
    expect(vaultSource).toContain("trpc.certificate.list.queryOptions");
    expect(vaultSource).toContain("trpc.certificate.upload.mutationOptions");
    expect(vaultSource).toContain("trpc.certificate.delete.mutationOptions");
    expect(vaultSource).toContain("trpc.certificate.usage.queryOptions");
    expect(vaultSource).toContain("trpc.certificate.getData");
    expect(vaultSource).toContain("router.push(`/audit?");
    expect(vaultSource).not.toContain("CertificatesSection");
  });

  it("leaves environment details with backend-only secret configuration", () => {
    const environmentPageSource = readFileSync("src/app/(dashboard)/environments/[id]/page.tsx", "utf8");

    expect(environmentPageSource).toContain("Secret Backend");
    expect(environmentPageSource).not.toContain("<SecretsSection");
    expect(environmentPageSource).not.toContain("<CertificatesSection");
  });
});
