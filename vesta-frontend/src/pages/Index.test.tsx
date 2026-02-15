import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

beforeEach(() => {
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

  it("shows first-run setup wizard when local setup is incomplete", async () => {
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
    vi.stubGlobal("fetch", fetchMock);

    render(<Index />);

    await waitFor(() => {
      expect(screen.getByText(/set up local ai/i)).toBeInTheDocument();
    });
  });
});
