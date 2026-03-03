const SECRET_REF_PATTERN = /^SECRET\[(.+)]$/;
const CERT_REF_PATTERN = /^CERT\[(.+)]$/;

export interface StrippedRef {
  name: string;
  componentKey: string;
}

export interface StripResult {
  config: Record<string, unknown>;
  strippedSecrets: StrippedRef[];
  strippedCertificates: StrippedRef[];
}

/**
 * Walk a config object and replace any `SECRET[name]` or `CERT[name]`
 * string values with empty strings.  Returns the cleaned config plus
 * lists of what was stripped so callers can inform the user.
 */
export function stripEnvRefs(
  config: Record<string, unknown>,
  componentKey: string,
): StripResult {
  const strippedSecrets: StrippedRef[] = [];
  const strippedCertificates: StrippedRef[] = [];

  const cleaned = walkAndStrip(
    config,
    componentKey,
    strippedSecrets,
    strippedCertificates,
  );

  return { config: cleaned, strippedSecrets, strippedCertificates };
}

function walkAndStrip(
  obj: Record<string, unknown>,
  componentKey: string,
  strippedSecrets: StrippedRef[],
  strippedCertificates: StrippedRef[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const secretMatch = value.match(SECRET_REF_PATTERN);
      if (secretMatch) {
        strippedSecrets.push({ name: secretMatch[1], componentKey });
        result[key] = "";
        continue;
      }

      const certMatch = value.match(CERT_REF_PATTERN);
      if (certMatch) {
        strippedCertificates.push({ name: certMatch[1], componentKey });
        result[key] = "";
        continue;
      }

      result[key] = value;
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = walkAndStrip(
        value as Record<string, unknown>,
        componentKey,
        strippedSecrets,
        strippedCertificates,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}
