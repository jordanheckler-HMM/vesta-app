import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Index from "./Index";

beforeEach(() => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ folders: [] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
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
    });
  });

  it("hides Files tab in mini view", () => {
    render(<Index isMiniView />);

    expect(screen.queryByRole("tab", { name: /files/i })).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /model selection/i })).toBeInTheDocument();
  });
});
