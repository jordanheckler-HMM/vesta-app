import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

beforeEach(() => {
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

    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Index", () => {
  it("uses condensed prompt and routing controls on the main chat view", async () => {
    render(<Index />);

    expect(screen.getByText(/prompt/i)).toBeInTheDocument();
    expect(screen.getByText(/routing/i)).toBeInTheDocument();
    expect(screen.queryByText(/what kind of thinking do you want to do/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("http://localhost:8090/folders");
      expect(fetch).toHaveBeenCalledWith("http://localhost:8090/conversations");
      expect(fetch).toHaveBeenCalledWith("http://localhost:8090/setup/prerequisites");
    });
  });

  it("hides Files tab in mini view", () => {
    render(<Index isMiniView />);

    expect(screen.queryByRole("tab", { name: /files/i })).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /model selection/i })).toBeInTheDocument();
  });

  it("shows Weather tab when weather status is enabled", async () => {
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
              required_models: [],
              available_models: [],
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
              enabled: true,
              has_cached_data: false,
              last_refresh_ts: null,
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Index />);

    expect(await screen.findByRole("tab", { name: /weather/i })).toBeInTheDocument();
  });

  it("hides Weather tab when weather status is disabled", async () => {
    render(<Index />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("http://localhost:8090/weather/status");
    });
    expect(screen.queryByRole("tab", { name: /weather/i })).not.toBeInTheDocument();
  });

  it("shows first-run setup wizard when local setup is incomplete", async () => {
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
      if (url.endsWith("/setup/prerequisites")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ollama_installed: false,
              ollama_running: false,
              required_models: [
                "hymetalab/vesta-lite",
                "hymetalab/vesta-general",
                "hymetalab/vesta-deep",
              ],
              available_models: [],
              missing_models: [
                "hymetalab/vesta-lite",
                "hymetalab/vesta-general",
                "hymetalab/vesta-deep",
              ],
              ready: false,
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Index />);

    await waitFor(() => {
      expect(screen.getByText(/set up local ai/i)).toBeInTheDocument();
    });
  });
});
