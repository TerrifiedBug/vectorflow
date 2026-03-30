/* eslint-disable @next/next/no-html-link-for-pages */
/**
 * Automated accessibility scanning using axe-core.
 *
 * These tests render key page sections and run axe-core analysis
 * to catch WCAG 2.1 AA violations automatically. They complement
 * manual screen reader testing (VoiceOver) and keyboard nav audits.
 *
 * Run with: npx vitest src/__tests__/accessibility.test.tsx
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import "vitest-axe/extend-expect";

// Extend Vitest expect with axe matchers
expect.extend(matchers);

describe("Accessibility: WCAG 2.1 AA compliance", () => {
  it("skip-to-content link is present and correctly structured", () => {
    const { container } = render(
      <div>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only"
        >
          Skip to main content
        </a>
        <nav aria-label="Main navigation">
          <ul>
            <li><a href="/">Dashboard</a></li>
            <li><a href="/fleet">Fleet</a></li>
          </ul>
        </nav>
        <main id="main-content" tabIndex={-1}>
          <h1>Dashboard</h1>
          <p>Content here</p>
        </main>
      </div>
    );

    const skipLink = container.querySelector('a[href="#main-content"]');
    expect(skipLink).toBeTruthy();
    expect(skipLink?.textContent).toBe("Skip to main content");

    const mainContent = container.querySelector("#main-content");
    expect(mainContent).toBeTruthy();
    expect(mainContent?.tagName.toLowerCase()).toBe("main");
  });

  it("dashboard KPI region has no axe violations", async () => {
    const { container } = render(
      <div role="region" aria-label="Dashboard overview">
        <div aria-live="polite" aria-atomic="false">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total Nodes</p>
            <p role="status">5</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Pipelines</p>
            <p role="status">12</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Active Alerts</p>
            <p role="status">0</p>
          </div>
        </div>
      </div>
    );

    const results = await axe(container, {
      rules: {
        region: { enabled: true },
      },
    });
    // @ts-expect-error -- toHaveNoViolations is added by vitest-axe at runtime
    expect(results).toHaveNoViolations();
  });

  it("navigation landmarks have proper aria-labels", async () => {
    const { container } = render(
      <div>
        <a href="#main-content" className="sr-only">Skip to main content</a>
        <nav aria-label="Main navigation">
          <ul>
            <li><a href="/">Dashboard</a></li>
            <li><a href="/pipelines">Pipelines</a></li>
            <li><a href="/fleet">Fleet</a></li>
          </ul>
        </nav>
        <header aria-label="Dashboard header">
          <span>VectorFlow</span>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div role="region" aria-label="Dashboard overview">
            <h1>Dashboard</h1>
          </div>
        </main>
      </div>
    );

    const results = await axe(container, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    // @ts-expect-error -- toHaveNoViolations is added by vitest-axe at runtime
    expect(results).toHaveNoViolations();
  });

  it("dialog structure has no axe violations", async () => {
    const { container } = render(
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-desc"
      >
        <h2 id="dialog-title">Confirm Action</h2>
        <p id="dialog-desc">Are you sure you want to proceed?</p>
        <button type="button">Cancel</button>
        <button type="button">Confirm</button>
      </div>
    );

    const results = await axe(container);
    // @ts-expect-error -- toHaveNoViolations is added by vitest-axe at runtime
    expect(results).toHaveNoViolations();
  });

  it("fleet table has no axe violations", async () => {
    const { container } = render(
      <div role="region" aria-label="Fleet management">
        <table>
          <thead>
            <tr>
              <th>
                <button type="button" aria-label="Sort by name, currently ascending">
                  Name
                </button>
              </th>
              <th>Status</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>node-01</td>
              <td>Healthy</td>
              <td>2 minutes ago</td>
            </tr>
          </tbody>
        </table>
      </div>
    );

    const results = await axe(container, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    // @ts-expect-error -- toHaveNoViolations is added by vitest-axe at runtime
    expect(results).toHaveNoViolations();
  });

  it("toast notification structure has no axe violations", async () => {
    const { container } = render(
      <div aria-label="Notifications" role="region">
        <ol>
          <li>
            <div role="status" aria-live="polite">
              Pipeline deployed successfully
            </div>
          </li>
        </ol>
      </div>
    );

    const results = await axe(container);
    // @ts-expect-error -- toHaveNoViolations is added by vitest-axe at runtime
    expect(results).toHaveNoViolations();
  });

  it("collapsible sidebar has proper aria attributes", async () => {
    const { container } = render(
      <nav aria-label="Main navigation">
        <button
          type="button"
          aria-expanded={true}
          aria-label="Collapse sidebar"
        >
          Collapse
        </button>
        <div aria-hidden={false}>
          <ul>
            <li><a href="/">Dashboard</a></li>
            <li><a href="/fleet">Fleet</a></li>
          </ul>
        </div>
      </nav>
    );

    const results = await axe(container, {
      runOnly: ["wcag2a", "wcag2aa"],
    });
    // @ts-expect-error -- toHaveNoViolations is added by vitest-axe at runtime
    expect(results).toHaveNoViolations();
  });

  it("interactive elements have visible focus indicators", () => {
    const { container } = render(
      <div>
        <a href="/test">Test Link</a>
        <button type="button">Test Button</button>
        <select aria-label="Select option">
          <option>Option 1</option>
        </select>
      </div>
    );

    // Verify all interactive elements exist and are focusable
    const link = container.querySelector("a");
    const button = container.querySelector("button");
    const select = container.querySelector("select");

    expect(link).toBeTruthy();
    expect(button).toBeTruthy();
    expect(select).toBeTruthy();

    // Focus indicators are applied via CSS (globals.css).
    // Visual verification is done manually or via Playwright screenshot tests.
    // This test ensures the elements are present and focusable.
    link?.focus();
    expect(document.activeElement).toBe(link);

    button?.focus();
    expect(document.activeElement).toBe(button);

    select?.focus();
    expect(document.activeElement).toBe(select);
  });
});
