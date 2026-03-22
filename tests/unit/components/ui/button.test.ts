/**
 * @file tests/unit/components/ui/button.test.ts
 * @description Unit tests for the Svelte 5 Button primitive component.
 *
 * Features:
 * - default rendering
 * - variants application
 * - polymorphic tags (a vs button)
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Button from "@src/components/ui/button.svelte";

describe("Button component", () => {
  it("renders correctly as a button by default", () => {
    const { getByRole } = render(Button, { type: "button" });
    const btn = getByRole("button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveClass("bg-primary-500"); // Default variant
  });

  it("renders as an anchor tag when href is provided", () => {
    const { getByRole } = render(Button, { href: "/dashboard" });
    const link = getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("applies the correct variant classes", () => {
    const { getByRole } = render(Button, { variant: "error" });
    const btn = getByRole("button");
    expect(btn).toHaveClass("bg-error-500");
  });

  it("reflects disabled state", () => {
    const { getByRole } = render(Button, { disabled: true });
    const btn = getByRole("button");
    expect(btn).toBeDisabled();
  });
});
