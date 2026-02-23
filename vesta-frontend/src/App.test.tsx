import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("App", () => {
  it("renders mini chat for production-style /index.html mini URL", () => {
    window.history.pushState({}, "", "/index.html?view=mini");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
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
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(screen.queryByText(/oops! page not found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /files/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: /model selection/i }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8090/setup/prerequisites");
  });
});
