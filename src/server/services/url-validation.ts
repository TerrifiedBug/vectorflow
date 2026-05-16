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
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "URL scheme must be http or https",
      });
    }
    hostname = parsed.hostname;
  } catch (err) {
    if (err instanceof TRPCError) throw err;
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

/**
 * SSRF protection for SMTP hosts: validates that a hostname resolves to a
 * public IP address. Same private-IP logic as `validatePublicUrl` but accepts
 * a bare hostname instead of a full URL.
 */
export async function validateSmtpHost(host: string): Promise<void> {
  // Strip brackets from IPv6 literal
  const bare = host.replace(/^\[/, "").replace(/\]$/, "");

  // Check if the host is already an IP literal
  if (isPrivateIP(bare)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "SMTP host resolves to a private or reserved IP address",
    });
  }

  // Resolve hostname to IP addresses
  try {
    const addresses = await dns.resolve4(host).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(host).catch(() => [] as string[]);
    const all = [...addresses, ...addresses6];

    if (all.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Could not resolve SMTP hostname",
      });
    }

    for (const ip of all) {
      if (isPrivateIP(ip)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "SMTP host resolves to a private or reserved IP address",
        });
      }
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Could not resolve SMTP hostname",
    });
  }
}

/**
 * Returns true when `ip` is in a private, reserved, link-local, loopback,
 * unique-local, or embedded-IPv4-private range that should never be the
 * target of an outbound HTTP request from the control plane.
 *
 * Exported so unit tests can probe edge cases (IPv4-mapped IPv6, cloud
 * metadata IPs, RFC 1918 ranges) without going through a real DNS lookup.
 */
export function isPrivateIP(ip: string): boolean {
  // IPv4 private/reserved ranges
  if (/^127\./.test(ip)) return true; // loopback
  if (/^10\./.test(ip)) return true; // RFC 1918
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // RFC 1918
  if (/^192\.168\./.test(ip)) return true; // RFC 1918
  if (/^169\.254\./.test(ip)) return true; // link-local — incl. 169.254.169.254 (cloud metadata)
  if (/^0\./.test(ip)) return true; // "this" network (0.0.0.0/8)
  if (ip === "255.255.255.255") return true; // broadcast

  // IPv6 private/reserved
  if (ip === "::1") return true; // loopback
  if (/^fe80:/i.test(ip)) return true; // link-local (fe80::/10)
  if (/^fc00:/i.test(ip) || /^fd[0-9a-f]{2}:/i.test(ip)) return true; // unique local (fc00::/7) — incl. fd00:ec2::254 (AWS IMDSv2 IPv6), fd00:1::3 (GCP)
  if (ip === "::") return true; // unspecified
  // Deprecated site-local fec0::/10 — first 10 bits 1111 1110 11. Hex
  // second nibble in {c, d, e, f}; covers fec0:..fed0:..feff:.. ranges,
  // not just fec0::/16.
  if (/^fe[cdef][0-9a-f]:/i.test(ip)) return true;

  // IPv4-mapped IPv6: ::ffff:a.b.c.d. Strip the prefix and recurse with
  // the bare IPv4 so we catch ::ffff:169.254.169.254 tunneled past a
  // naive IPv6-only check.
  const v4Mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (v4Mapped) return isPrivateIP(v4Mapped[1]);

  // 6to4 (2002::/16) encapsulates an IPv4 in the next 32 bits.
  // Refuse 6to4 wholesale — embedded IPv4 may be private, and a
  // legitimate target almost certainly has a native IPv6.
  if (/^2002:/i.test(ip)) return true;

  // Teredo (2001::/32) — first 32 bits = 2001:0000. Match the explicit
  // form (2001:0:, 2001:00:, 2001:0000:) AND the compressed form
  // (2001:: where the second hextet's zero is collapsed).
  if (/^2001:(?:0+|):/i.test(ip)) return true;

  return false;
}
