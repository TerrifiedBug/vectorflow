import { describe, it, expect } from "vitest";
import {
  easings,
  durations,
  fadeIn,
  fadeInUp,
  slideInLeft,
  slideInRight,
  slideInUp,
  slideInDown,
  scaleIn,
  staggerContainer,
  staggerItem,
  pageEnter,
  pageExit,
  springTransition,
} from "../variants";

describe("easings", () => {
  it("enter is [0.25, 0.1, 0.25, 1]", () => {
    expect(easings.enter).toEqual([0.25, 0.1, 0.25, 1]);
  });

  it("exit is [0.4, 0, 1, 1]", () => {
    expect(easings.exit).toEqual([0.4, 0, 1, 1]);
  });
});

describe("durations", () => {
  it("all values are numbers greater than 0", () => {
    for (const value of Object.values(durations)) {
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThan(0);
    }
  });

  it("has fast, normal, slow, page keys", () => {
    expect(durations).toMatchObject({
      fast: expect.any(Number),
      normal: expect.any(Number),
      slow: expect.any(Number),
      page: expect.any(Number),
    });
  });
});

describe("named variants have initial and animate properties", () => {
  const variants = [
    ["fadeIn", fadeIn],
    ["fadeInUp", fadeInUp],
    ["slideInLeft", slideInLeft],
    ["slideInRight", slideInRight],
    ["slideInUp", slideInUp],
    ["slideInDown", slideInDown],
    ["scaleIn", scaleIn],
    ["pageEnter", pageEnter],
    ["pageExit", pageExit],
  ] as const;

  for (const [name, variant] of variants) {
    it(`${name} has initial and animate keys`, () => {
      expect(variant).toHaveProperty("initial");
      expect(variant).toHaveProperty("animate");
    });
  }
});

describe("pageEnter", () => {
  it("initial starts with opacity 0", () => {
    expect((pageEnter.initial as Record<string, unknown>).opacity).toBe(0);
  });

  it("animate reaches opacity 1", () => {
    expect((pageEnter.animate as Record<string, unknown>).opacity).toBe(1);
  });
});

describe("staggerContainer", () => {
  it("is a function", () => {
    expect(typeof staggerContainer).toBe("function");
  });

  it("returns variants with hidden and visible keys", () => {
    const result = staggerContainer(5);
    expect(result).toHaveProperty("hidden");
    expect(result).toHaveProperty("visible");
  });

  it("visible transition has staggerChildren", () => {
    const result = staggerContainer(5);
    const visible = result.visible as { transition?: { staggerChildren?: number } };
    expect(visible.transition?.staggerChildren).toBeGreaterThan(0);
  });

  it("staggerChildren is capped at 0.03 for large lists", () => {
    const result = staggerContainer(100);
    const visible = result.visible as { transition?: { staggerChildren?: number } };
    expect(visible.transition?.staggerChildren).toBeLessThanOrEqual(0.03);
  });
});

describe("staggerItem", () => {
  it("has hidden and visible keys", () => {
    expect(staggerItem).toHaveProperty("hidden");
    expect(staggerItem).toHaveProperty("visible");
  });

  it("hidden state has opacity 0", () => {
    expect((staggerItem.hidden as Record<string, unknown>).opacity).toBe(0);
  });

  it("visible state has opacity 1", () => {
    expect((staggerItem.visible as Record<string, unknown>).opacity).toBe(1);
  });
});

describe("springTransition", () => {
  it("has type 'spring'", () => {
    expect(springTransition.type).toBe("spring");
  });

  it("has stiffness greater than 0", () => {
    expect(typeof springTransition.stiffness).toBe("number");
    expect(springTransition.stiffness).toBeGreaterThan(0);
  });

  it("has damping greater than 0", () => {
    expect(typeof springTransition.damping).toBe("number");
    expect(springTransition.damping).toBeGreaterThan(0);
  });
});
