/**
 * @file tests/unit/components/ui/card.test.ts
 * @description Unit tests for the Svelte 5 Card primitive component.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Card from "@src/components/ui/card.svelte";

describe("Card component", () => {
  it("renders basic structure", () => {
    const { container } = render(Card);
    const el = container.firstElementChild;
    expect(el).toHaveClass("rounded-lg");
    expect(el).toHaveClass("shadow-sm");
  });

  it("accepts additional classes", () => {
    const { container } = render(Card, { class: "custom-card-class" });
    expect(container.firstElementChild).toHaveClass("custom-card-class");
  });
});
