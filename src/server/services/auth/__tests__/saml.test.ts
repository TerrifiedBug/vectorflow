import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

// ─── @node-saml/node-saml mock ──────────────────────────────────────────────
// The library does the real XML/signature/audience/expiry/InResponseTo work;
// we mock it to (a) return a verified profile for the accept path, (b) throw
// for each reject path, and (c) capture the constructor options + cache
// provider so we can assert our hardened security posture and replay binding.
const { samlCtor, validateMock, getAuthorizeUrlMock } = vi.hoisted(() => ({
  samlCtor: vi.fn(),
  validateMock: vi.fn(),
  getAuthorizeUrlMock: vi.fn(),
}));

vi.mock("@node-saml/node-saml", () => ({
  SAML: class {
    constructor(opts: unknown) {
      samlCtor(opts);
    }
    validatePostResponseAsync = validateMock;
    getAuthorizeUrlAsync = getAuthorizeUrlMock;
  },
  generateServiceProviderMetadata: vi.fn(() => "<EntityDescriptor/>"),
  ValidateInResponseTo: { never: "never", ifPresent: "ifPresent", always: "always" },
}));

// ─── dependency mocks ────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/org-settings", () => ({ getOrgSettings: vi.fn() }));
vi.mock("@/lib/org-context", () => ({ runWithOrgContext: vi.fn() }));
vi.mock("@/lib/with-org-tx", () => ({ withOrgTx: vi.fn() }));
vi.mock("@/server/services/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/services/group-mappings", () => ({ reconcileUserTeamMemberships: vi.fn() }));
vi.mock("@/server/services/auth/jwt-key", () => ({ getSessionSigningKey: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  debugLog: vi.fn(),
  infoLog: vi.fn(),
  warnLog: vi.fn(),
  errorLog: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/org-settings";
import { runWithOrgContext } from "@/lib/org-context";
import { withOrgTx } from "@/lib/with-org-tx";
import { reconcileUserTeamMemberships } from "@/server/services/group-mappings";
import { mockOrgSettings } from "@/__tests__/helpers/mock-org-settings";
import {
  validateSamlResponse,
  sanitizeReturnTo,
  provisionSamlUser,
  extractSamlEmail,
  extractSamlGroups,
  buildSamlSessionCookie,
  type SamlEndpoints,
} from "@/server/services/auth/saml";
import { getSamlSettings, type SamlSettings } from "@/server/services/auth/saml-config";
import { getSessionSigningKey } from "@/server/services/auth/jwt-key";
import { decode } from "next-auth/jwt";
import type { CacheProvider, Profile } from "@node-saml/node-saml";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const ENDPOINTS: SamlEndpoints = {
  origin: "https://acme.vectorflow.sh",
  secure: true,
  spEntityId: "https://acme.vectorflow.sh/api/auth/saml/metadata",
  acsUrl: "https://acme.vectorflow.sh/api/auth/saml/callback",
};

const SETTINGS: SamlSettings = {
  organizationId: "org-1",
  idpEntityId: "https://idp.example.com/entity",
  ssoUrl: "https://idp.example.com/sso",
  idpCert: "-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----",
  enforced: false,
  groupAttribute: "groups",
};

function verifiedProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    issuer: SETTINGS.idpEntityId,
    nameID: "user@acme.com",
    nameIDFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    email: "user@acme.com",
    ...overrides,
  } as Profile;
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  // Default passthroughs for the org-context wrappers.
  vi.mocked(runWithOrgContext).mockImplementation(
    async (_orgId: string, fn: () => Promise<unknown>) => fn(),
  );
  vi.mocked(withOrgTx).mockImplementation(
    ((_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})) as unknown as typeof withOrgTx,
  );
});

describe("validateSamlResponse", () => {
  it("returns the profile when @node-saml verifies the response", async () => {
    validateMock.mockResolvedValue({ profile: verifiedProfile(), loggedOut: false });

    const profile = await validateSamlResponse(SETTINGS, ENDPOINTS, "base64-response", "rid-1");

    expect(profile.email).toBe("user@acme.com");
    expect(validateMock).toHaveBeenCalledWith({ SAMLResponse: "base64-response" });
  });

  it("constructs node-saml with the hardened security options", async () => {
    validateMock.mockResolvedValue({ profile: verifiedProfile(), loggedOut: false });

    await validateSamlResponse(SETTINGS, ENDPOINTS, "base64-response", "rid-1");

    expect(samlCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        // Trust anchor + identities.
        idpCert: SETTINGS.idpCert,
        entryPoint: SETTINGS.ssoUrl,
        idpIssuer: SETTINGS.idpEntityId,
        issuer: ENDPOINTS.spEntityId,
        callbackUrl: ENDPOINTS.acsUrl,
        // The non-negotiable security gates.
        wantAuthnResponseSigned: true,
        wantAssertionsSigned: true,
        audience: ENDPOINTS.spEntityId,
        validateInResponseTo: "always",
      }),
    );
  });

  it("binds InResponseTo to the issued request id via the cache provider", async () => {
    validateMock.mockResolvedValue({ profile: verifiedProfile(), loggedOut: false });

    await validateSamlResponse(SETTINGS, ENDPOINTS, "base64-response", "rid-1");

    const opts = samlCtor.mock.calls[0]![0] as { cacheProvider: CacheProvider };
    // Only the request id we issued is accepted; any other (replayed/unsolicited
    // InResponseTo) resolves null, which makes node-saml reject the response.
    await expect(opts.cacheProvider.getAsync("rid-1")).resolves.not.toBeNull();
    await expect(opts.cacheProvider.getAsync("rid-other")).resolves.toBeNull();
  });

  it("rejects when no request id is expected (unsolicited / no state cookie)", async () => {
    validateMock.mockResolvedValue({ profile: verifiedProfile(), loggedOut: false });

    await validateSamlResponse(SETTINGS, ENDPOINTS, "base64-response", null);

    const opts = samlCtor.mock.calls[0]![0] as { cacheProvider: CacheProvider };
    await expect(opts.cacheProvider.getAsync("rid-1")).resolves.toBeNull();
  });

  it.each([
    ["unsigned response", "SAML assertion is not signed"],
    ["bad signature", "Invalid signature on documentElement"],
    ["wrong audience", "SAML assertion audience mismatch. Expected: ..."],
    ["expired assertion", "SAML assertion expired: clocks skewed too much"],
    ["replayed InResponseTo", "InResponseTo is not valid"],
  ])("rejects and yields no profile on %s", async (_label, message) => {
    validateMock.mockRejectedValue(new Error(message));

    await expect(
      validateSamlResponse(SETTINGS, ENDPOINTS, "base64-response", "rid-1"),
    ).rejects.toThrow(message);
  });

  it("rejects when the library returns a null profile", async () => {
    validateMock.mockResolvedValue({ profile: null, loggedOut: false });

    await expect(
      validateSamlResponse(SETTINGS, ENDPOINTS, "base64-response", "rid-1"),
    ).rejects.toThrow(/did not yield a profile/);
  });
});

describe("extractSamlEmail / extractSamlGroups", () => {
  it("prefers email, then mail, then an email-shaped nameID", () => {
    expect(extractSamlEmail(verifiedProfile({ email: "a@x.com" }))).toBe("a@x.com");
    expect(
      extractSamlEmail(verifiedProfile({ email: undefined, mail: "b@x.com" } as Partial<Profile>)),
    ).toBe("b@x.com");
    expect(
      extractSamlEmail({ nameID: "c@x.com", nameIDFormat: "", issuer: "" } as Profile),
    ).toBe("c@x.com");
    expect(
      extractSamlEmail({ nameID: "not-an-email", nameIDFormat: "", issuer: "" } as Profile),
    ).toBeNull();
  });

  it("normalises single, multi-value, and missing group attributes", () => {
    expect(extractSamlGroups({ groups: "eng" } as unknown as Profile, "groups")).toEqual(["eng"]);
    expect(
      extractSamlGroups({ groups: ["eng", "ops", "eng"] } as unknown as Profile, "groups"),
    ).toEqual(["eng", "ops"]);
    expect(
      extractSamlGroups({ attributes: { Roles: ["admin"] } } as unknown as Profile, "Roles"),
    ).toEqual(["admin"]);
    expect(extractSamlGroups(verifiedProfile(), "groups")).toEqual([]);
  });
});

describe("provisionSamlUser — group→team reconciliation", () => {
  it("reconciles team memberships from the configured group attribute", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      name: "User",
      authMethod: "OIDC",
    } as never);
    vi.mocked(getOrgSettings).mockResolvedValue(
      mockOrgSettings({ organizationId: "org-1", scimEnabled: false, oidcDefaultTeamId: null }) as never,
    );

    const profile = verifiedProfile({ groups: ["team-eng", "team-ops"] } as Partial<Profile>);
    const result = await provisionSamlUser("org-1", SETTINGS, profile, "1.2.3.4");

    expect(result).toEqual({ userId: "u1" });
    expect(reconcileUserTeamMemberships).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      ["team-eng", "team-ops"],
      "org-1",
    );
    // Reconciliation runs inside the org transaction context.
    expect(withOrgTx).toHaveBeenCalledWith("org-1", expect.any(Function));
  });

  it("does not reconcile when no group attribute is configured", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      name: "User",
      authMethod: "OIDC",
    } as never);
    vi.mocked(getOrgSettings).mockResolvedValue(mockOrgSettings({ organizationId: "org-1" }) as never);

    const result = await provisionSamlUser(
      "org-1",
      { ...SETTINGS, groupAttribute: null },
      verifiedProfile({ groups: ["team-eng"] } as Partial<Profile>),
      null,
    );

    expect(result).toEqual({ userId: "u1" });
    expect(reconcileUserTeamMemberships).not.toHaveBeenCalled();
  });

  it("refuses to link onto an existing non-SSO (LOCAL) account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u2",
      email: "user@acme.com",
      name: "Local User",
      authMethod: "LOCAL",
    } as never);
    vi.mocked(getOrgSettings).mockResolvedValue(mockOrgSettings({ organizationId: "org-1" }) as never);

    const result = await provisionSamlUser("org-1", SETTINGS, verifiedProfile(), null);

    expect(result).toEqual({ errorRedirect: "/login?error=local_account" });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(reconcileUserTeamMemberships).not.toHaveBeenCalled();
  });

  it("auto-provisions a new user with the external-SSO (OIDC) auth marker", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: "u3", email: "user@acme.com", name: "user" } as never);
    vi.mocked(getOrgSettings).mockResolvedValue(
      mockOrgSettings({ organizationId: "org-1", oidcDefaultTeamId: null }) as never,
    );

    const result = await provisionSamlUser(
      "org-1",
      { ...SETTINGS, groupAttribute: null },
      verifiedProfile(),
      null,
    );

    expect(result).toEqual({ userId: "u3" });
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "user@acme.com", authMethod: "OIDC" }),
      }),
    );
  });
});

describe("getSamlSettings — enforced gating", () => {
  it("surfaces enforced=true when SAML is enabled and fully configured", async () => {
    vi.mocked(getOrgSettings).mockResolvedValue(
      mockOrgSettings({
        organizationId: "org-1",
        samlEnabled: true,
        samlEnforced: true,
        samlIdpEntityId: "https://idp.example.com/entity",
        samlIdpSsoUrl: "https://idp.example.com/sso",
        samlIdpCert: "CERT",
      }) as never,
    );

    const settings = await getSamlSettings("org-1");
    expect(settings).not.toBeNull();
    expect(settings!.enforced).toBe(true);
    expect(settings!.idpCert).toBe("CERT");
  });

  it("returns null (gate OFF) when samlEnforced is set but SAML is not enabled", async () => {
    // Guards against locking everyone out: enforcement requires a usable IdP.
    vi.mocked(getOrgSettings).mockResolvedValue(
      mockOrgSettings({
        organizationId: "org-1",
        samlEnabled: false,
        samlEnforced: true,
        samlIdpEntityId: "https://idp.example.com/entity",
        samlIdpSsoUrl: "https://idp.example.com/sso",
        samlIdpCert: "CERT",
      }) as never,
    );

    await expect(getSamlSettings("org-1")).resolves.toBeNull();
  });

  it("returns null when enabled but the IdP certificate is missing", async () => {
    vi.mocked(getOrgSettings).mockResolvedValue(
      mockOrgSettings({
        organizationId: "org-1",
        samlEnabled: true,
        samlIdpEntityId: "https://idp.example.com/entity",
        samlIdpSsoUrl: "https://idp.example.com/sso",
        samlIdpCert: null,
      }) as never,
    );

    await expect(getSamlSettings("org-1")).resolves.toBeNull();
  });
});

describe("sanitizeReturnTo — open-redirect prevention", () => {
  it("keeps a safe same-origin path (with query + hash)", () => {
    expect(sanitizeReturnTo("/pipelines?x=1#h")).toBe("/pipelines?x=1#h");
  });

  it("defaults to / for null / non-relative / protocol-relative inputs", () => {
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo("https://evil.com")).toBe("/");
    expect(sanitizeReturnTo("//evil.com")).toBe("/");
  });

  it("rejects backslash paths that fold to a foreign origin (open redirect)", () => {
    // Backslashes are folded to "/" by the WHATWG URL parser for http(s), so
    // these escape to https://evil.com/ and MUST be rejected.
    for (const evil of ["/\\evil.com", "/\\/evil.com", "/\\@evil.com"]) {
      expect(sanitizeReturnTo(evil)).toBe("/");
    }
  });

  it("keeps a tab-containing path same-origin (folds to a local path, not a redirect)", () => {
    // A tab is stripped, leaving "/evil.com//" — a path on THIS origin, safe.
    expect(sanitizeReturnTo("/\tevil.com//")).toBe("/evil.com//");
  });
});

describe("buildSamlSessionCookie — suite_role claim + 24h lifetime", () => {
  beforeEach(() => {
    vi.mocked(getSessionSigningKey).mockResolvedValue("test-signing-secret");
  });

  it("mints a 24h cookie carrying id/provider/org_id/authedAt plus suite_role=admin for an org OWNER", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "OWNER" } as never);
    prismaMock.teamMember.findMany.mockResolvedValue([] as never);

    const cookie = await buildSamlSessionCookie({
      orgId: "default",
      userId: "u1",
      name: "User One",
      email: "user@acme.com",
      secure: false,
    });

    expect(cookie.options.maxAge).toBe(60 * 60 * 24);

    const claims = await decode({
      salt: cookie.name,
      secret: "test-signing-secret",
      token: cookie.value,
    });
    expect(claims).toMatchObject({
      id: "u1",
      provider: "saml",
      org_id: "default",
      suite_role: "admin",
    });
    expect(typeof claims!.authedAt).toBe("number");
    const lifetime = (claims!.exp as number) - (claims!.iat as number);
    expect(lifetime).toBeGreaterThan(60 * 60 * 23);
    expect(lifetime).toBeLessThanOrEqual(60 * 60 * 24);
  });

  it("stamps suite_role=editor for a plain MEMBER with a team EDITOR role", async () => {
    prismaMock.orgMember.findUnique.mockResolvedValue({ role: "MEMBER" } as never);
    prismaMock.teamMember.findMany.mockResolvedValue([{ role: "EDITOR" }] as never);

    const cookie = await buildSamlSessionCookie({
      orgId: "default",
      userId: "u2",
      name: null,
      email: "editor@acme.com",
      secure: false,
    });

    const claims = await decode({
      salt: cookie.name,
      secret: "test-signing-secret",
      token: cookie.value,
    });
    expect(claims!.suite_role).toBe("editor");
  });
});
