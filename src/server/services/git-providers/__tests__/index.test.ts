import { describe, it, expect } from "vitest";
import { detectProvider, getProvider } from "../index";

describe("detectProvider", () => {
  it("detects github from HTTPS URL", () => {
    expect(detectProvider("https://github.com/acme/configs.git")).toBe("github");
  });

  it("detects github from SSH URL", () => {
    expect(detectProvider("git@github.com:acme/configs.git")).toBe("github");
  });

  it("detects gitlab from HTTPS URL", () => {
    expect(detectProvider("https://gitlab.com/acme/configs")).toBe("gitlab");
  });

  it("detects gitlab from SSH URL", () => {
    expect(detectProvider("git@gitlab.com:acme/configs.git")).toBe("gitlab");
  });

  it("detects bitbucket from HTTPS URL", () => {
    expect(detectProvider("https://bitbucket.org/acme/configs")).toBe("bitbucket");
  });

  it("detects bitbucket from SSH URL", () => {
    expect(detectProvider("git@bitbucket.org:acme/configs.git")).toBe("bitbucket");
  });

  it("returns null for self-hosted GitLab instance (no .gitlab.com)", () => {
    // Custom domains require explicit gitProvider field
    expect(detectProvider("https://git.internal.corp/team/repo")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(detectProvider("not-a-url")).toBeNull();
  });
});

describe("getProvider", () => {
  it("uses explicit gitProvider over URL detection", () => {
    const provider = getProvider({
      gitProvider: "gitlab",
      gitRepoUrl: "https://github.com/acme/configs",
    });
    expect(provider?.name).toBe("gitlab");
  });

  it("auto-detects from URL when gitProvider is null", () => {
    const provider = getProvider({
      gitProvider: null,
      gitRepoUrl: "https://github.com/acme/configs",
    });
    expect(provider?.name).toBe("github");
  });

  it("returns null when both gitProvider and gitRepoUrl are null", () => {
    const provider = getProvider({ gitProvider: null, gitRepoUrl: null });
    expect(provider).toBeNull();
  });

  it("returns null for unsupported explicit provider name", () => {
    const provider = getProvider({
      gitProvider: "mercurial",
      gitRepoUrl: null,
    });
    expect(provider).toBeNull();
  });

  it("returns correct provider for each supported type", () => {
    expect(getProvider({ gitProvider: "github", gitRepoUrl: null })?.name).toBe("github");
    expect(getProvider({ gitProvider: "gitlab", gitRepoUrl: null })?.name).toBe("gitlab");
    expect(getProvider({ gitProvider: "bitbucket", gitRepoUrl: null })?.name).toBe("bitbucket");
  });
});
