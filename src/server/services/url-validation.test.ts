import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import dns from "dns/promises";
import { validatePublicUrl } from "@/server/services/url-validation";

vi.mock("dns/promises", () => ({
  default: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
  },
}));

describe("validatePublicUrl", () => {
  it("rejects non-http webhook schemes before DNS resolution", async () => {
    await expect(validatePublicUrl("file:///etc/passwd")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "URL scheme must be http or https",
    } satisfies Partial<TRPCError>);

    expect(dns.resolve4).not.toHaveBeenCalled();
    expect(dns.resolve6).not.toHaveBeenCalled();
  });

  it("allows http and https URLs that resolve to public addresses", async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(["93.184.216.34"]);
    vi.mocked(dns.resolve6).mockResolvedValue([]);

    await expect(validatePublicUrl("https://example.com/webhook")).resolves.toBeUndefined();
    await expect(validatePublicUrl("http://example.com/webhook")).resolves.toBeUndefined();
  });
});
