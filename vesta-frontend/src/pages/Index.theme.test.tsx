import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

beforeEach(() => {
  document.documentElement.classList.remove("dark", "manila");
  window.localStorage.clear();

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/folders")) {
      return Promise.resolve(
        new Response(JSON.stringify({ folders: [] }), { status: 200 }),
      );
    }
    if (url.endsWith("/conversations")) {
      return Promise.resolve(
        new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
      );
    }
    if (url.endsWith("/setup/prerequisites")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ollama_installed: true,
            ollama_running: true,
            required_models: [
              "hymetalab/vesta-lite",
              "hymetalab/vesta-general",
              "hymetalab/vesta-deep",
            ],
            available_models: [
              "hymetalab/vesta-lite",
              "hymetalab/vesta-general",
              "hymetalab/vesta-deep",
            ],
            missing_models: [],
            ready: true,
          }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/weather/status")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            enabled: false,
            reason: "missing_api_key",
            has_cached_data: false,
            last_refresh_ts: null,
          }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/settings/profile")) {
      return Promise.resolve(
        new Response(JSON.stringify({ profile: "default" }), { status: 200 }),
      );
    }
    if (url.endsWith("/settings/models")) {
      return Promise.resolve(
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
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
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
