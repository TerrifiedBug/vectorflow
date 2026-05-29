/**
 * OIDC `email_verified` gate (VF-31).
 *
 * The OIDC sign-in callback auto-provisions a new user or proceeds for an
 * existing OIDC account based on the profile email. Before VF-31 there was no
 * check of the standard `email_verified` claim, so an IdP that issues tokens
 * for unverified addresses could provision/own an account for an email the
 * user never proved control of.
 *
 * Policy (standard OIDC interpretation):
 *   - claim present and === true  → email is usable.
 *   - claim present and falsey     → REFUSE (deny provisioning/linking).
 *   - claim absent                 → usable. The claim is optional in OIDC and
 *     some self-managed IdPs omit it; trust is bounded by the fact that each
 *     org's admin configures their own trusted issuer per tenant (the reason
 *     VF-31 is rated Low). We do not block configured IdPs that simply never
 *     emit the claim, which would be a hard regression for them.
 *
 * Some IdPs send the claim as a string ("true"/"false"); normalise both.
 */
export function isOidcEmailVerified(
  profile: Record<string, unknown> | undefined | null,
): boolean {
  const raw = profile?.email_verified;

  // Claim absent — preserve existing behaviour (see policy note above).
  if (raw === undefined || raw === null) return true;

  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw.trim().toLowerCase() === "true";

  // Any other shape (number, object, …) is not a trustworthy `true`.
  return false;
}
