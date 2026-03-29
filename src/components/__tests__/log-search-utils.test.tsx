// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { highlightAllMatches, countMatches } from "@/components/log-search-utils";

describe("highlightAllMatches", () => {
  it("returns plain text when search is empty", () => {
    const result = highlightAllMatches("hello world", "");
    expect(result).toBe("hello world");
  });

  it("returns plain text when no match found", () => {
    const result = highlightAllMatches("hello world", "xyz");
    expect(result).toBe("hello world");
  });

  it("highlights a single match", () => {
    const { container } = render(<>{highlightAllMatches("hello world", "world")}</>);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("world");
  });

  it("highlights multiple matches", () => {
    const { container } = render(<>{highlightAllMatches("foo bar foo baz foo", "foo")}</>);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(3);
  });

  it("is case-insensitive", () => {
    const { container } = render(<>{highlightAllMatches("Hello HELLO hello", "hello")}</>);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(3);
  });

  it("preserves non-matching text between matches", () => {
    const { container } = render(<>{highlightAllMatches("aXbXc", "X")}</>);
    expect(container.textContent).toBe("aXbXc");
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
  });
});

describe("countMatches", () => {
  it("returns 0 for empty search", () => {
    expect(countMatches("hello", "")).toBe(0);
  });

  it("counts all occurrences case-insensitively", () => {
    expect(countMatches("foo bar Foo BAZ FOO", "foo")).toBe(3);
  });

  it("returns 0 when no match", () => {
    expect(countMatches("hello", "xyz")).toBe(0);
  });
});
