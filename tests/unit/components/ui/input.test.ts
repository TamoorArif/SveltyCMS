/**
 * @file tests/unit/components/ui/input.test.ts
 * @description Unit tests for the Svelte 5 Input primitive component.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Input from "@src/components/ui/input.svelte";

describe("Input component", () => {
  it("renders a standard text input", () => {
    const { getByRole } = render(Input, { type: "text" });
    const input = getByRole("textbox");
    expect(input).toBeInTheDocument();
  });

  it("renders a label and links it to the input via ID", () => {
    const { getByLabelText } = render(Input, { label: "Username" });
    const input = getByLabelText("Username");
    expect(input).toBeInTheDocument();
  });

  it("renders error state", () => {
    const { getByText, getByRole } = render(Input, { type: "text", error: "Invalid field" });
    expect(getByText("Invalid field")).toBeInTheDocument();
    const input = getByRole("textbox");
    expect(input).toHaveClass("border-error-500");
  });
});
