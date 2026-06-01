/**
 * WebAuthn / passkey service tests.
 *
 * The library `@simplewebauthn/server` is mocked at the module boundary so
 * these tests focus on the wiring this codebase owns:
 *   - challenge persistence + TTL + single-use consumption
 *   - credential row creation on successful registration
 *   - cross-user / wrong-kind / expired challenge rejection
 *   - counter monotonicity enforcement on authentication
 *   - cleanup sweep
 *
 * End-to-end attestation/assertion crypto is the library's responsibility
 * and exercised by its own test suite — duplicating that surface here would
 * be ceremony without insight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

vi.mock("@/lib/prisma", () => { const __pm = mockDeep<PrismaClient>(); return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm }; });

const mockGenerateRegistrationOptions = vi.fn();
const mockVerifyRegistrationResponse = vi.fn();
const mockGenerateAuthenticationOptions = vi.fn();
const mockVerifyAuthenticationResponse = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (...args: unknown[]) =>
    mockGenerateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) =>
    mockVerifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args: unknown[]) =>
    mockGenerateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args: unknown[]) =>
    mockVerifyAuthenticationResponse(...args),
}));

import { prisma } from "@/lib/prisma";
import {
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  gcExpiredChallenges,
} from "@/server/services/webauthn";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const RP = {
  rpName: "VectorFlow",
  rpID: "vectorflow.sh",
  expectedOrigin: "https://acme.vectorflow.sh",
};

beforeEach(() => {
  mockReset(prismaMock);
  mockGenerateRegistrationOptions.mockReset();
  mockVerifyRegistrationResponse.mockReset();
  mockGenerateAuthenticationOptions.mockReset();
  mockVerifyAuthenticationResponse.mockReset();
  // Default $transaction wires the callback to the prismaMock — every test
  // can then control individual operations via the per-model mocks.
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startRegistration", () => {
  it("calls library with the rp config and persists a 5min challenge", async () => {
    mockGenerateRegistrationOptions.mockResolvedValue({
      challenge: "challenge-base64url",
      rp: { name: RP.rpName, id: RP.rpID },
    });
    prismaMock.webAuthnChallenge.create.mockResolvedValue({} as never);

    const opts = await startRegistration({
      rp: RP,
      userId: "user-1",
      userName: "alice@example.com",
      userDisplayName: "Alice",
      existingCredentials: [
        { credentialId: "existing-cred", transports: ["internal"] },
      ],
    });

    expect(opts.challenge).toBe("challenge-base64url");
    expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpName: RP.rpName,
        rpID: RP.rpID,
        userName: "alice@example.com",
        userDisplayName: "Alice",
        excludeCredentials: [
          { id: "existing-cred", transports: ["internal"] },
        ],
        attestationType: "none",
      }),
    );

    const challengeRow = prismaMock.webAuthnChallenge.create.mock.calls[0][0];
    expect(challengeRow.data.kind).toBe("register");
    expect(challengeRow.data.challenge).toBe("challenge-base64url");
    expect(challengeRow.data.userId).toBe("user-1");
    const ttlMs = (challengeRow.data.expiresAt as Date).getTime() - Date.now();
    // 5 minutes ± 2s tolerance.
    expect(ttlMs).toBeGreaterThan(5 * 60 * 1000 - 2000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});

describe("finishRegistration", () => {
  function makeResponse() {
    return {
      id: "new-cred-id",
      rawId: "new-cred-id",
      response: {
        attestationObject: "att",
        clientDataJSON: "clientDataJSON-token",
      },
      type: "public-key",
      clientExtensionResults: {},
    } as never;
  }

  it("verifies, persists the credential, and consumes the challenge", async () => {
    // The library calls expectedChallenge(challenge) — we return true via
    // the DB lookup. Capture the call so we can simulate the policy.
    mockVerifyRegistrationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("issued-challenge");
      if (!ok) return { verified: false };
      return {
        verified: true,
        registrationInfo: {
          credential: {
            id: "new-cred-id",
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ["internal"],
          },
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      };
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "register",
      challenge: "issued-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    prismaMock.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.webAuthnCredential.create.mockResolvedValue({
      id: "cred-row-1",
      credentialId: "new-cred-id",
      userId: "user-1",
    } as never);

    const result = await finishRegistration({
      rp: RP,
      userId: "user-1",
      response: makeResponse(),
      name: "MacBook TouchID",
    });

    expect(result.credentialId).toBe("new-cred-id");
    expect(prismaMock.webAuthnCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        credentialId: "new-cred-id",
        counter: BigInt(0),
        transports: ["internal"],
        deviceType: "multiDevice",
        backedUp: true,
        name: "MacBook TouchID",
      }),
    });
    // Single-use challenge: consumed.
    expect(prismaMock.webAuthnChallenge.deleteMany).toHaveBeenCalled();
  });

  it("throws when the challenge is for a different user", async () => {
    mockVerifyRegistrationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("attacker-supplied-challenge");
      return { verified: ok } as never;
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "register",
      challenge: "attacker-supplied-challenge",
      userId: "victim-user",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(
      finishRegistration({
        rp: RP,
        userId: "attacker-user",
        response: makeResponse(),
      }),
    ).rejects.toThrow(/registration verification failed/i);
    expect(prismaMock.webAuthnCredential.create).not.toHaveBeenCalled();
  });

  it("throws when the challenge has expired", async () => {
    mockVerifyRegistrationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("issued-challenge");
      return { verified: ok } as never;
    });
    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "register",
      challenge: "issued-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1_000), // expired 1s ago
    } as never);

    await expect(
      finishRegistration({
        rp: RP,
        userId: "user-1",
        response: makeResponse(),
      }),
    ).rejects.toThrow(/registration verification failed/i);
  });

  it("rejects an `authenticate` challenge being reused for registration", async () => {
    mockVerifyRegistrationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("misused-challenge");
      return { verified: ok } as never;
    });
    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "authenticate", // wrong kind
      challenge: "misused-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(
      finishRegistration({
        rp: RP,
        userId: "user-1",
        response: makeResponse(),
      }),
    ).rejects.toThrow(/registration verification failed/i);
  });
});

describe("startAuthentication", () => {
  it("populates allowCredentials when userId is provided", async () => {
    prismaMock.webAuthnCredential.findMany.mockResolvedValue([
      {
        credentialId: "cred-a",
        transports: ["internal", "hybrid"],
      },
      {
        credentialId: "cred-b",
        transports: ["usb"],
      },
    ] as never);
    mockGenerateAuthenticationOptions.mockResolvedValue({
      challenge: "auth-challenge",
    });
    prismaMock.webAuthnChallenge.create.mockResolvedValue({} as never);

    await startAuthentication({ rp: RP, userId: "user-1" });

    expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: RP.rpID,
        allowCredentials: [
          { id: "cred-a", transports: ["internal", "hybrid"] },
          { id: "cred-b", transports: ["usb"] },
        ],
      }),
    );
  });

  it("supports the usernameless flow with empty allowCredentials", async () => {
    mockGenerateAuthenticationOptions.mockResolvedValue({
      challenge: "usernameless-challenge",
    });
    prismaMock.webAuthnChallenge.create.mockResolvedValue({} as never);

    await startAuthentication({ rp: RP });

    const call = mockGenerateAuthenticationOptions.mock.calls[0][0];
    expect(call.allowCredentials).toEqual([]);
    expect(prismaMock.webAuthnCredential.findMany).not.toHaveBeenCalled();
  });
});

describe("finishAuthentication", () => {
  function makeResponse(credentialId = "cred-a") {
    return {
      id: credentialId,
      rawId: credentialId,
      response: {
        clientDataJSON: "auth-clientDataJSON-token",
        authenticatorData: "auth-data",
        signature: "sig",
      },
      type: "public-key",
      clientExtensionResults: {},
    } as never;
  }

  it("verifies, bumps the counter, and returns the userId", async () => {
    prismaMock.webAuthnCredential.findUnique.mockResolvedValue({
      id: "row-1",
      credentialId: "cred-a",
      userId: "user-1",
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(5),
      transports: ["internal"],
    } as never);

    mockVerifyAuthenticationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("issued-auth-challenge");
      if (!ok) return { verified: false };
      return {
        verified: true,
        authenticationInfo: { newCounter: 6 },
      };
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "authenticate",
      challenge: "issued-auth-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    prismaMock.webAuthnCredential.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 } as never);

    const result = await finishAuthentication({
      rp: RP,
      response: makeResponse(),
    });

    expect(result.userId).toBe("user-1");
    expect(prismaMock.webAuthnCredential.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "row-1", counter: BigInt(5) },
        data: expect.objectContaining({ counter: BigInt(6) }),
      }),
    );
  });

  it("rejects an assertion whose counter did not advance (replay)", async () => {
    prismaMock.webAuthnCredential.findUnique.mockResolvedValue({
      id: "row-1",
      credentialId: "cred-a",
      userId: "user-1",
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(5),
      transports: [],
    } as never);

    mockVerifyAuthenticationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("issued-auth-challenge");
      return ok
        ? { verified: true, authenticationInfo: { newCounter: 4 } }
        : { verified: false };
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "authenticate",
      challenge: "issued-auth-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(
      finishAuthentication({ rp: RP, response: makeResponse() }),
    ).rejects.toThrow(/counter regression/i);
    expect(prismaMock.webAuthnCredential.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the counter changed under us (concurrent authentication race)", async () => {
    prismaMock.webAuthnCredential.findUnique.mockResolvedValue({
      id: "row-1",
      credentialId: "cred-a",
      userId: "user-1",
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(5),
      transports: [],
    } as never);

    mockVerifyAuthenticationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("issued-auth-challenge");
      return ok
        ? { verified: true, authenticationInfo: { newCounter: 6 } }
        : { verified: false };
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "authenticate",
      challenge: "issued-auth-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    // Race: a parallel transaction already bumped the counter, so the
    // conditional updateMany matches zero rows.
    prismaMock.webAuthnCredential.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      finishAuthentication({ rp: RP, response: makeResponse() }),
    ).rejects.toThrow(/concurrent assertion race/i);
  });

  it("accepts an assertion whose counter is 0 (platform authenticators don't increment)", async () => {
    prismaMock.webAuthnCredential.findUnique.mockResolvedValue({
      id: "row-1",
      credentialId: "cred-a",
      userId: "user-1",
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(0),
      transports: [],
    } as never);

    mockVerifyAuthenticationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("issued-auth-challenge");
      return ok
        ? { verified: true, authenticationInfo: { newCounter: 0 } }
        : { verified: false };
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "authenticate",
      challenge: "issued-auth-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    prismaMock.webAuthnCredential.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 1 } as never);

    const result = await finishAuthentication({
      rp: RP,
      response: makeResponse(),
    });
    expect(result.userId).toBe("user-1");
  });

  it("rejects an unknown credential", async () => {
    prismaMock.webAuthnCredential.findUnique.mockResolvedValue(null);

    await expect(
      finishAuthentication({ rp: RP, response: makeResponse("ghost") }),
    ).rejects.toThrow(/credential not registered/i);
  });

  it("rejects a register-kind challenge being reused for authentication", async () => {
    prismaMock.webAuthnCredential.findUnique.mockResolvedValue({
      id: "row-1",
      credentialId: "cred-a",
      userId: "user-1",
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(0),
      transports: [],
    } as never);

    mockVerifyAuthenticationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("misused-challenge");
      return { verified: ok } as never;
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "register", // wrong kind
      challenge: "misused-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(
      finishAuthentication({ rp: RP, response: makeResponse() }),
    ).rejects.toThrow(/authentication verification failed/i);
  });

  it("rejects a 0 counter when the stored counter has already advanced (cloned authenticator)", async () => {
    // Previously the code exempted ANY `newCounter === 0`. A credential
    // that was at counter=5 returning a fresh assertion with counter=0
    // is the cloned-authenticator signal we MUST reject; the platform-
    // authenticator 0/0 carve-out only applies when BOTH sides are 0.
    prismaMock.webAuthnCredential.findUnique.mockResolvedValue({
      id: "row-1",
      credentialId: "cred-a",
      userId: "user-1",
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(5),
      transports: [],
    } as never);

    mockVerifyAuthenticationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("issued-auth-challenge");
      return ok
        ? { verified: true, authenticationInfo: { newCounter: 0 } }
        : { verified: false };
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "authenticate",
      challenge: "issued-auth-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(
      finishAuthentication({ rp: RP, response: makeResponse() }),
    ).rejects.toThrow(/counter regression/i);
  });

  it("rejects authentication race-loser: deleteMany returns 0 (challenge already consumed)", async () => {
    prismaMock.webAuthnCredential.findUnique.mockResolvedValue({
      id: "row-1",
      credentialId: "cred-a",
      userId: "user-1",
      publicKey: Buffer.from([1, 2, 3]),
      counter: BigInt(5),
      transports: [],
    } as never);

    mockVerifyAuthenticationResponse.mockImplementation(async (opts) => {
      const ok = await opts.expectedChallenge("issued-auth-challenge");
      return ok
        ? { verified: true, authenticationInfo: { newCounter: 6 } }
        : { verified: false };
    });

    prismaMock.webAuthnChallenge.findUnique.mockResolvedValue({
      id: "ch-1",
      kind: "authenticate",
      challenge: "issued-auth-challenge",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    prismaMock.webAuthnCredential.updateMany.mockResolvedValue({ count: 1 } as never);
    // Race: the parallel transaction won; our deleteMany affects 0 rows.
    prismaMock.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      finishAuthentication({ rp: RP, response: makeResponse() }),
    ).rejects.toThrow(/already consumed/i);
  });
});

describe("gcExpiredChallenges", () => {
  it("deletes rows whose expiresAt is in the past", async () => {
    prismaMock.webAuthnChallenge.deleteMany.mockResolvedValue({ count: 7 } as never);
    const now = new Date("2026-05-16T12:00:00.000Z");
    await expect(gcExpiredChallenges(() => now)).resolves.toBe(7);
    expect(prismaMock.webAuthnChallenge.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });
  });
});
