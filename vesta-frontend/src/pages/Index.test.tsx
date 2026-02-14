import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Index from "./Index";

describe("Index", () => {
  it("hides Files tab in mini view", () => {
    render(<Index isMiniView />);

    expect(screen.queryByRole("tab", { name: /files/i })).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /model selection/i })).toBeInTheDocument();
  });
});
