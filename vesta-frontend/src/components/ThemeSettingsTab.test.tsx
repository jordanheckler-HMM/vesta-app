import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ThemeSettingsTab from "./ThemeSettingsTab";

afterEach(() => {
  cleanup();
});

describe("ThemeSettingsTab", () => {
  it("calls onThemeChange with the selected style", () => {
    const onThemeChange = vi.fn();

    render(<ThemeSettingsTab theme="light" onThemeChange={onThemeChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /dark mode/i }));

    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("updates and saves model mapping from dropdowns", () => {
    const onModelSettingChange = vi.fn();
    const onSaveModelSettings = vi.fn();

    render(
      <ThemeSettingsTab
        theme="light"
        onThemeChange={vi.fn()}
        modelSettings={{
          lite: "model-a",
          general: "model-b",
          deep: "model-c",
        }}
        availableModels={["model-a", "model-b", "model-c", "model-d"]}
        onModelSettingChange={onModelSettingChange}
        onSaveModelSettings={onSaveModelSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText(/lite model/i), {
      target: { value: "model-d" },
    });
    expect(onModelSettingChange).toHaveBeenCalledWith("lite", "model-d");

    fireEvent.click(screen.getByRole("button", { name: /save model mapping/i }));
    expect(onSaveModelSettings).toHaveBeenCalled();
  });

  it("triggers approved setup action from settings", () => {
    const onRunPrerequisiteSetup = vi.fn();

    render(
      <ThemeSettingsTab
        theme="light"
        onThemeChange={vi.fn()}
        setupStatus={{
          ollama_installed: true,
          ollama_running: false,
          required_models: [
            "hymetalab/vesta-lite",
            "hymetalab/vesta-general",
            "hymetalab/vesta-deep",
          ],
          available_models: ["hymetalab/vesta-lite"],
          missing_models: ["hymetalab/vesta-general", "hymetalab/vesta-deep"],
          ready: false,
        }}
        onRunPrerequisiteSetup={onRunPrerequisiteSetup}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /approve and set up/i }));
    expect(onRunPrerequisiteSetup).toHaveBeenCalled();
    expect(screen.getByText(/missing models:/i)).toBeInTheDocument();
  });
});
