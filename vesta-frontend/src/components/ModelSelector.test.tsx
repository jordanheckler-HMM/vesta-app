import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ModelSelector from "./ModelSelector";

describe("ModelSelector", () => {
  it("calls onModelChange with the selected model", () => {
    const onModelChange = vi.fn();

    render(<ModelSelector selectedModel="auto" onModelChange={onModelChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /general/i }));

    expect(onModelChange).toHaveBeenCalledWith("general");
  });
});
