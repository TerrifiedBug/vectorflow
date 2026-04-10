// @vitest-environment jsdom

/**
 * AnimatedNumber component tests.
 *
 * Because the motion/react hooks rely on a browser environment we annotate
 * the file with the jsdom pragma above.  The reduced-motion path returns a
 * plain <span> immediately; that is what we test here so we can stay
 * synchronous (no react-act / animation flush required).
 *
 * We mock `motion/react` to make `useReducedMotion` controllable, and also
 * supply no-op stubs for the motion value hooks so the inner component can
 * mount without a real animation runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock motion/react before importing the component
// ---------------------------------------------------------------------------

const mockUseReducedMotion = vi.fn(() => true); // default: reduced motion ON

vi.mock('motion/react', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
  useMotionValue: (initial: number) => ({
    set: vi.fn(),
    get: () => initial,
  }),
  useSpring: (mv: unknown) => mv,
  useTransform: (_mv: unknown, fn: (v: number) => string) => ({
    on: () => () => {},
    get: () => fn(0),
  }),
}));

// Also mock the re-export hook so the import path resolves correctly.
vi.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { AnimatedNumber } from '../animated-number';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnimatedNumber', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(true);
  });

  it('renders the value as text content', () => {
    const { container } = render(<AnimatedNumber value={42} />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('42');
  });

  it('applies Math.round to the value', () => {
    const { container } = render(<AnimatedNumber value={42.7} />);
    const span = container.querySelector('span');
    expect(span!.textContent).toBe('43');
  });

  it('accepts a formatter function', () => {
    const formatter = (v: number) => `$${v.toLocaleString()}`;
    const { container } = render(
      <AnimatedNumber value={1000} formatter={formatter} />,
    );
    const span = container.querySelector('span');
    expect(span!.textContent).toBe('$1,000');
  });

  it('renders a span element', () => {
    const { container } = render(<AnimatedNumber value={99} />);
    expect(container.querySelector('span')).not.toBeNull();
  });

  it('passes className to the span', () => {
    const { container } = render(
      <AnimatedNumber value={5} className="kpi-value" />,
    );
    const span = container.querySelector('span.kpi-value');
    expect(span).not.toBeNull();
  });

  it('has AnimatedNumber displayName', () => {
    expect(AnimatedNumber.displayName).toBe('AnimatedNumber');
  });

  describe('with motion enabled (reduced motion OFF)', () => {
    beforeEach(() => {
      mockUseReducedMotion.mockReturnValue(false);
    });

    it('still renders a span with the initial formatted value', () => {
      const { container } = render(<AnimatedNumber value={7} />);
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      // The inner component sets initial textContent to the formatted value.
      expect(span!.textContent).toBe('7');
    });

    it('uses formatter in the animated path', () => {
      const { container } = render(
        <AnimatedNumber value={500} formatter={(v) => `${v}%`} />,
      );
      const span = container.querySelector('span');
      expect(span!.textContent).toBe('500%');
    });
  });
});
