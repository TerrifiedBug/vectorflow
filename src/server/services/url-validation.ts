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

  // IPv4-mapped IPv6 has TWO wire forms (RFC 4291):
  //   1. Dotted-quad: ::ffff:169.254.169.254
  //   2. Hex:         ::ffff:a9fe:a9fe (same address)
  // Node's URL/IP parsers accept both. Decode either back to its
  // bare IPv4 and recurse so e.g. ::ffff:a9fe:a9fe (== 169.254.169.254)
  // is rejected the same as the dotted form.
  const v4MappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (v4MappedDotted) return isPrivateIP(v4MappedDotted[1]);
  const v4MappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (v4MappedHex) {
    const high = parseInt(v4MappedHex[1], 16);
    const low = parseInt(v4MappedHex[2], 16);
    // Reconstruct the IPv4 dotted form from the two 16-bit halves.
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    return isPrivateIP(`${a}.${b}.${c}.${d}`);
  }

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

/**
 * True when the deployment is running in Cloud-strict outbound mode.
 *
 * In Cloud-strict mode every outbound HTTP request that points at a
 * user-supplied URL (Vector node fetch, AI baseUrl, …) MUST be funnelled
 * through `validateOutboundUrl` first. Self-hosted (OSS) deployments leave
 * this off so they can reach legitimate localhost / private-network
 * services like a locally-running Ollama or an in-cluster Vector agent
 * exposed on an RFC 1918 address.
 *
 * Toggle via env: `VF_CLOUD_STRICT_OUTBOUND=true`.
 */
export function isCloudStrictOutbound(): boolean {
  return process.env.VF_CLOUD_STRICT_OUTBOUND === "true";
}

/**
 * Same private-IP / public-resolution policy as `validatePublicUrl` but
 * throws a plain `Error` instead of a `TRPCError`. Use this from service
 * layers and route handlers that aren't tRPC procedures (Vector node
 * fetch, AI provider calls, channel deliveries, etc.).
 *
 * When `VF_CLOUD_STRICT_OUTBOUND` is unset (OSS default) and `opts.force`
 * is not set, validation is skipped \u2014 self-hosted users routinely target
 * localhost / private IPs and we don't want a hard SSRF policy to break
 * their config.
 *
 * Pass `{ force: true }` from callsites where the URL is *always*
 * customer-controlled (channel webhooks, OIDC discovery, BYOK KMS).
 * Those keep the existing strict behaviour regardless of the env flag.
 */
export async function validateOutboundUrl(
  url: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!opts.force && !isCloudStrictOutbound()) return;

  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("URL scheme must be http or https");
    }
    hostname = parsed.hostname;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("URL scheme")) throw err;
    throw new Error("Invalid URL");
  }

  const bare = hostname.replace(/^\[/, "").replace(/\]$/, "");
  const lowered = bare.toLowerCase();
  // Reject by hostname before DNS \u2014 catches names that always point
  // somewhere private regardless of resolver answer (loopback, mDNS,
  // internal TLDs, GCP metadata).
  if (
    lowered === "localhost" ||
    lowered.endsWith(".localhost") ||
    lowered.endsWith(".local") ||
    lowered.endsWith(".internal") ||
    lowered === "metadata.google.internal"
  ) {
    throw new Error("URL resolves to a private or reserved IP address");
  }
  if (isPrivateIP(bare)) {
    throw new Error("URL resolves to a private or reserved IP address");
  }

  // Public IP literals don't have a DNS record. After the isPrivateIP guard
  // accepts them they must short-circuit before dns.resolve4/resolve6,
  // otherwise ENOTFOUND trips the "Could not resolve hostname" branch and
  // a perfectly valid `http://8.8.8.8/` config gets rejected in strict mode.
  const isLiteralIPv4 = /^\d+\.\d+\.\d+\.\d+$/.test(bare);
  const isLiteralIPv6 = bare.includes(":");
  if (isLiteralIPv4 || isLiteralIPv6) {
    return;
  }
  const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
  const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
  const all = [...addresses, ...addresses6];
  if (all.length === 0) {
    throw new Error("Could not resolve hostname");
  }
  for (const ip of all) {
    if (isPrivateIP(ip)) {
      throw new Error("URL resolves to a private or reserved IP address");
    }
  }
}
