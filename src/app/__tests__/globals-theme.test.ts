/**
 * Theme palette guard for src/app/globals.css.
 *
 * The theme system (next-themes, attribute="class", defaultTheme="dark") relies
 * on `:root` holding the LIGHT palette and `.dark` holding the DARK palette. A
 * regression where both blocks carry identical (dark) values silently breaks the
 * light theme — toggling to light still renders dark. These tests parse the real
 * CSS and assert the two palettes genuinely differ AND that the light palette
 * meets WCAG 2.1 AA contrast (dark text on light surfaces).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** Return the declaration body between `<selector> {` and its closing `}`.
 *  Custom-property blocks contain no nested braces, so the first `}` closes it. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

/** Parse `--name: value;` declarations from a block body into a Map. */
function vars(body: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) map.set(m[1], m[2].trim());
  return map;
}

/** Resolve a value to a concrete token, following `var(--x)` chains in-block. */
function resolveVar(map: Map<string, string>, name: string, depth = 0): string {
  const raw = map.get(name);
  if (raw === undefined) throw new Error(`missing var ${name}`);
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw);
  if (ref && depth < 10) return resolveVar(map, ref[1], depth + 1);
  return raw;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const a = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/** WCAG contrast ratio between two solid hex colors. */
function contrast(aHex: string, bHex: string): number {
  const la = luminance(hexToRgb(aHex));
  const lb = luminance(hexToRgb(bHex));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const root = vars(block(":root"));
const dark = vars(block(".dark"));

// Surface + text base tokens that MUST visibly differ between the two themes.
const KEY_SURFACE_TEXT = [
  "--bg", "--bg-1", "--bg-2", "--bg-3", "--bg-4",
  "--line", "--line-2", "--line-3",
  "--fg", "--fg-1", "--fg-2", "--fg-3",
] as const;

describe("globals.css theme palettes", () => {
  it("defines both :root (light) and .dark (dark) blocks", () => {
    expect(root.size).toBeGreaterThan(20);
    expect(dark.size).toBeGreaterThan(20);
  });

  it("exposes the identical variable set in both themes (so every component works in both)", () => {
    const rootNames = [...root.keys()].filter((n) => n !== "--radius").sort();
    const darkNames = [...dark.keys()].sort();
    // :root carries theme-agnostic --radius + font aliases; ignore --radius/--font-*.
    const rootColorNames = rootNames.filter((n) => !n.startsWith("--font-"));
    expect(rootColorNames).toEqual(darkNames);
  });

  it("uses DIFFERENT values for every key surface/text variable (dark-only can't regress)", () => {
    for (const name of KEY_SURFACE_TEXT) {
      const lightVal = resolveVar(root, name);
      const darkVal = resolveVar(dark, name);
      expect(lightVal, `${name} must differ between light and dark`).not.toBe(darkVal);
    }
  });

  it(":root is a light theme (text darker than surface) and .dark is inverted", () => {
    const lightBg = luminance(hexToRgb(resolveVar(root, "--bg")));
    const lightFg = luminance(hexToRgb(resolveVar(root, "--fg")));
    const darkBg = luminance(hexToRgb(resolveVar(dark, "--bg")));
    const darkFg = luminance(hexToRgb(resolveVar(dark, "--fg")));
    // Light: surface bright, text dark.
    expect(lightBg).toBeGreaterThan(lightFg);
    expect(lightBg).toBeGreaterThan(0.5);
    // Dark: surface dark, text bright (unchanged baseline).
    expect(darkFg).toBeGreaterThan(darkBg);
    expect(darkBg).toBeLessThan(0.1);
  });

  it("light theme meets WCAG AA (>=4.5:1) for primary text on key surfaces", () => {
    const fg = resolveVar(root, "--foreground"); // -> --fg
    const pairs: Array<[string, string]> = [
      ["--background", fg],
      ["--card", fg],
      ["--popover", fg],
      ["--secondary", resolveVar(root, "--secondary-foreground")],
      ["--accent", resolveVar(root, "--accent-foreground")],
    ];
    for (const [surfaceVar, textHex] of pairs) {
      const surface = resolveVar(root, surfaceVar);
      const ratio = contrast(surface, textHex);
      expect(ratio, `${textHex} on ${surfaceVar} (${surface}) = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("light theme meets WCAG AA for muted text on muted surface", () => {
    const muted = resolveVar(root, "--muted"); // -> --bg-3
    const mutedFg = resolveVar(root, "--muted-foreground"); // -> --fg-2
    expect(contrast(muted, mutedFg)).toBeGreaterThanOrEqual(4.5);
  });

  it("light theme uses an accessible focus ring (>=3:1 vs background)", () => {
    const ring = resolveVar(root, "--ring");
    const bg = resolveVar(root, "--background");
    expect(contrast(ring, bg)).toBeGreaterThanOrEqual(3);
  });
});
