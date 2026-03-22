/**
 * @file tests/unit/components/ui/badge.test.ts
 * @description Unit tests for the Svelte 5 Badge primitive component.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Badge from "@src/components/ui/badge.svelte";

describe("Badge component", () => {
  it("renders correctly with default primary variant", () => {
    // Because it's a div, we get it by a generic way or testid.
    // Let's pass a class to easily grab it, or use container.
    const { container } = render(Badge);
    const el = container.firstElementChild;
    expect(el).toHaveClass("bg-primary-500");
    expect(el).toHaveClass("rounded-full");
  });

  it("applies success variant", () => {
    const { container } = render(Badge, { variant: "success" });
    const el = container.firstElementChild;
    expect(el).toHaveClass("bg-success-500");
  });
});
