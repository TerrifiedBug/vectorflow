// @vitest-environment jsdom

/**
 * LoginPage prefill tests.
 *
 * Verifies that visiting /login?prefill=demo pre-populates the email and
 * password fields with the demo credentials, and that absent params leave
 * the fields empty.
 *
 * Mock conventions match error-state.test.tsx and flow-canvas.test.tsx:
 *  - mock motion/react-m → plain HTML (no animation runtime)
 *  - mock @/hooks/use-reduced-motion → returns false (motion on, but
 *    m.div is already a plain div so this branch is harmless)
 *  - vitest globals:false — import everything from vitest explicitly
 *  - no auto-cleanup — call cleanup() in afterEach
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ---------------------------------------------------------------------------
// Motion mock — m.div → plain div so no animation runtime is needed
// ---------------------------------------------------------------------------
vi.mock("motion/react-m", () => ({ div: "div" }));

// ---------------------------------------------------------------------------
// Reduced-motion mock — keep motion branch consistent; value doesn't affect
// the prefill logic under test
// ---------------------------------------------------------------------------
vi.mock("@/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

// ---------------------------------------------------------------------------
// next/navigation — useRouter + useSearchParams
// We swap useSearchParams per test via the factory below.
// ---------------------------------------------------------------------------
const mockSearchParams = vi.fn(() => new URLSearchParams());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mockSearchParams(),
}));

// ---------------------------------------------------------------------------
// next-auth/react — signIn is irrelevant to prefill; stub it out
// ---------------------------------------------------------------------------
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// fetch — the component fires fetch('/api/setup') and fetch('/api/auth/oidc-status')
// in a useEffect after mount. Stub both to avoid network errors, returning
// values that keep the page in the normal (local-auth) state.
// ---------------------------------------------------------------------------
vi.stubGlobal(
  "fetch",
  vi.fn((url: string) => {
    if (url === "/api/setup") {
      return Promise.resolve({
        json: () => Promise.resolve({ setupRequired: false }),
      });
    }
    if (url === "/api/auth/oidc-status") {
      return Promise.resolve({
        json: () =>
          Promise.resolve({
            enabled: false,
            displayName: "SSO",
            localAuthDisabled: false,
          }),
      });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  }),
);

// ---------------------------------------------------------------------------
// Import component after all mocks are registered
// ---------------------------------------------------------------------------
import LoginPage from "../page";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginPage prefill", () => {
  it("prefills email and password when ?prefill=demo", async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams("prefill=demo"));

    const { container } = render(<LoginPage />);

    // The component shows a spinner while fetching /api/setup and /api/auth/oidc-status.
    // Wait for the email input to appear after the setup check resolves.
    await waitFor(() => {
      const email = container.querySelector('input[name="email"]');
      expect(email).not.toBeNull();
    });

    const email = container.querySelector(
      'input[name="email"]',
    ) as HTMLInputElement;
    const password = container.querySelector(
      'input[name="password"]',
    ) as HTMLInputElement;

    expect(password).not.toBeNull();
    expect(email.value).toBe("demo@demo.local");
    expect(password.value).toBe("demo");
  });

  it("renders empty fields when prefill param is absent", async () => {
    mockSearchParams.mockReturnValue(new URLSearchParams());

    const { container } = render(<LoginPage />);

    await waitFor(() => {
      const email = container.querySelector('input[name="email"]');
      expect(email).not.toBeNull();
    });

    const email = container.querySelector(
      'input[name="email"]',
    ) as HTMLInputElement;
    const password = container.querySelector(
      'input[name="password"]',
    ) as HTMLInputElement;

    expect(password).not.toBeNull();
    expect(email.value).toBe("");
    expect(password.value).toBe("");
  });
});
