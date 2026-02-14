import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

beforeEach(() => {
  document.documentElement.classList.remove("dark", "manila");
  window.localStorage.clear();

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ folders: [] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          configured_models: {
            lite: "hymetalab/vesta-lite",
            general: "hymetalab/vesta-general",
            deep: "hymetalab/vesta-deep",
          },
          available_models: [
            "hymetalab/vesta-lite",
            "hymetalab/vesta-general",
            "hymetalab/vesta-deep",
          ],
          ollama_connected: true,
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  document.documentElement.classList.remove("dark", "manila");
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Index theme settings", () => {
  it("applies manila folder mode from settings", async () => {
    render(<Index />);

    const settingsTab = screen.getByRole("tab", { name: /settings/i });
    fireEvent.mouseDown(settingsTab);
    fireEvent.click(settingsTab);

    const manilaOption = await waitFor(() =>
      screen.getByRole("radio", { name: /manila folder mode/i }),
    );
    fireEvent.click(manilaOption);

    expect(document.documentElement.classList.contains("manila")).toBe(true);
    expect(window.localStorage.getItem("vesta-theme")).toBe("manila");
  });
});
