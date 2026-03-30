// src/server/services/cert-expiry-checker.ts
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/server/services/crypto";
import { fireEventAlert } from "@/server/services/event-alerts";

// ─── Configuration ─────────────────────────────────────────────────────────

/** Default threshold: alert when certificate expires within this many days. */
const DEFAULT_EXPIRY_THRESHOLD_DAYS = 30;

/** Minimum interval between checks for the same certificate (24 hours). */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// In-memory map to avoid re-alerting for the same certificate within the check interval.
// Keyed by certificate ID, value is the last check timestamp.
const lastChecked = new Map<string, number>();

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse the notAfter date from a PEM-encoded certificate.
 * Returns null if the data is not a parseable X.509 certificate
 * (e.g., it could be a private key or CA bundle).
 */
export function parseCertExpiry(pem: string): Date | null {
  try {
    const x509 = new crypto.X509Certificate(pem);
    return new Date(x509.validTo);
  } catch {
    // Not a parseable X.509 certificate (could be a key file or malformed PEM)
    return null;
  }
}

/**
 * Calculate the number of days until a certificate expires.
 * Returns a negative number if the certificate has already expired.
 */
export function daysUntilExpiry(expiryDate: Date, now: Date = new Date()): number {
  const diffMs = expiryDate.getTime() - now.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Check all certificates across all environments for impending expiry.
 * Fires `certificate_expiring` event alerts for certificates within the
 * threshold.
 *
 * Designed to be called on a periodic interval (e.g., by FleetAlertService).
 * Errors are logged but never thrown — certificate checks must not break
 * the calling poll loop.
 */
export async function checkCertificateExpiry(
  thresholdDays: number = DEFAULT_EXPIRY_THRESHOLD_DAYS,
): Promise<number> {
  let alertsFired = 0;
  const now = new Date();

  try {
    // Fetch all certificates (minimal fields + encrypted data for parsing)
    const certificates = await prisma.certificate.findMany({
      where: { fileType: { in: ["cert", "ca"] } },
      select: {
        id: true,
        name: true,
        environmentId: true,
        encryptedData: true,
        fileType: true,
      },
    });

    for (const cert of certificates) {
      try {
        // Skip if we checked this certificate recently
        const lastCheckTime = lastChecked.get(cert.id);
        if (lastCheckTime && now.getTime() - lastCheckTime < CHECK_INTERVAL_MS) {
          continue;
        }

        // Decrypt and parse the certificate
        const pemData = decrypt(cert.encryptedData);

        // Mark as checked regardless of whether it fires or is parseable
        lastChecked.set(cert.id, now.getTime());

        const expiryDate = parseCertExpiry(pemData);

        if (!expiryDate) {
          // Not a parseable certificate (key file, etc.) — skip
          continue;
        }

        const days = daysUntilExpiry(expiryDate, now);

        if (days <= thresholdDays) {
          const isExpired = days <= 0;
          const message = isExpired
            ? `Certificate "${cert.name}" has expired (expired ${Math.abs(Math.round(days))} days ago)`
            : `Certificate "${cert.name}" expires in ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;

          await fireEventAlert("certificate_expiring", cert.environmentId, {
            message,
            certificateId: cert.id,
            certificateName: cert.name,
            expiryDate: expiryDate.toISOString(),
            daysUntilExpiry: Math.round(days),
          });
          alertsFired++;
        }
      } catch (certErr) {
        // Per-certificate isolation — one cert failure must not stop others
        console.error(
          `[cert-expiry] Error checking certificate ${cert.id}:`,
          certErr,
        );
      }
    }
  } catch (err) {
    console.error("[cert-expiry] Error in checkCertificateExpiry:", err);
  }

  return alertsFired;
}

/**
 * Clear the in-memory check cache. Useful for testing.
 */
export function clearCheckCache(): void {
  lastChecked.clear();
}
