import { TRPCError } from "@trpc/server";
import dns from "dns/promises";

/**
 * SSRF protection: validates that a URL resolves to a public IP address.
 * Rejects private/reserved IP ranges (RFC 1918, loopback, link-local, etc.).
 */
export async function validatePublicUrl(url: string): Promise<void> {
  let hostname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid URL",
    });
  }

  // Strip brackets from IPv6 literal
  const bare = hostname.replace(/^\[/, "").replace(/\]$/, "");

  // Check if the hostname is already an IP literal
  if (isPrivateIP(bare)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "URL resolves to a private or reserved IP address",
    });
  }

  // Resolve hostname to IP addresses
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const all = [...addresses, ...addresses6];

    if (all.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Could not resolve hostname",
      });
    }

    for (const ip of all) {
      if (isPrivateIP(ip)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "URL resolves to a private or reserved IP address",
        });
      }
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Could not resolve hostname",
    });
  }
}

function isPrivateIP(ip: string): boolean {
  // IPv4 private/reserved ranges
  if (/^127\./.test(ip)) return true; // loopback
  if (/^10\./.test(ip)) return true; // RFC 1918
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // RFC 1918
  if (/^192\.168\./.test(ip)) return true; // RFC 1918
  if (/^169\.254\./.test(ip)) return true; // link-local
  if (/^0\./.test(ip)) return true; // "this" network
  if (ip === "255.255.255.255") return true; // broadcast

  // IPv6 private/reserved
  if (ip === "::1") return true; // loopback
  if (/^fe80:/i.test(ip)) return true; // link-local
  if (/^fc00:/i.test(ip) || /^fd[0-9a-f]{2}:/i.test(ip)) return true; // unique local (fc00::/7)
  if (ip === "::") return true; // unspecified

  return false;
}
