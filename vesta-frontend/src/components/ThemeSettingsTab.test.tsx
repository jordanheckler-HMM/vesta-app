import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ThemeSettingsTab from "./ThemeSettingsTab";

describe("ThemeSettingsTab", () => {
  it("calls onThemeChange with the selected style", () => {
    const onThemeChange = vi.fn();

    render(<ThemeSettingsTab theme="light" onThemeChange={onThemeChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /dark mode/i }));

    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });
});
