// @vitest-environment jsdom

/**
 * ErrorState component tests.
 *
 * Mock patterns match pressable-scale.test.tsx:
 *  - mock motion/react-m → plain HTML elements (no animation runtime needed)
 *  - mock @/hooks/use-reduced-motion to control the reduced-motion branch
 *
 * Note: vitest.config.ts has globals:false so @testing-library/react does NOT
 * auto-cleanup. We call cleanup() explicitly in afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock motion/react-m so m.div renders as a plain div
// ---------------------------------------------------------------------------

vi.mock('motion/react-m', () => ({
  div: 'div',
  span: 'span',
}));

// Mock useReducedMotion — default: motion ON (false = do not reduce)
const mockUseReducedMotion = vi.fn(() => false);

vi.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------

import { ErrorState } from '../error-state';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorState', () => {
  const mockReset = vi.fn();

  beforeEach(() => {
    mockReset.mockReset();
    mockUseReducedMotion.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders heading "Something went wrong"', () => {
    const { container } = render(
      <ErrorState error={new Error('boom')} reset={mockReset} />,
    );
    const heading = within(container).getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Something went wrong');
  });

  it('renders "Try again" button', () => {
    const { container } = render(
      <ErrorState error={new Error('boom')} reset={mockReset} />,
    );
    const button = within(container).getByRole('button', { name: /try again/i });
    expect(button).toBeTruthy();
  });

  it('calls reset callback when "Try again" button is clicked', () => {
    const { container } = render(
      <ErrorState error={new Error('boom')} reset={mockReset} />,
    );
    fireEvent.click(within(container).getByRole('button', { name: /try again/i }));
    expect(mockReset).toHaveBeenCalledOnce();
  });

  it('renders error digest when provided', () => {
    const errorWithDigest = Object.assign(new Error('boom'), { digest: 'abc123' });
    const { container } = render(
      <ErrorState error={errorWithDigest} reset={mockReset} />,
    );
    expect(within(container).getByText('abc123')).toBeTruthy();
  });

  it('does NOT render digest section when no digest is present', () => {
    const { container } = render(
      <ErrorState error={new Error('boom')} reset={mockReset} />,
    );
    // "Error ID:" label should not appear when digest is absent
    expect(within(container).queryByText(/error id/i)).toBeNull();
  });

  it('respects reduced motion — FadeIn renders static fallback div', () => {
    mockUseReducedMotion.mockReturnValue(true);
    // When reduced motion is on, FadeIn returns a plain <div> (no m.div).
    // The component should still render without error and show expected content.
    const { container } = render(
      <ErrorState error={new Error('boom')} reset={mockReset} />,
    );
    const heading = within(container).getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Something went wrong');
    expect(within(container).getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
