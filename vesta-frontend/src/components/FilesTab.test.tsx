import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FilesTab from "./FilesTab";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FilesTab", () => {
  it("uploads files and renders ingestion status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ filename: "sop.txt", status: "indexed" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documents: [
              {
                id: "doc-1",
                filename: "sop.txt",
                content_hash: "abc",
                size_bytes: 123,
                chunk_count: 1,
                created_at: "1700000000",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<FilesTab />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:8090/knowledge/files");
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["SOP body"], "sop.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8090/knowledge/files",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(await screen.findByText(/last upload/i)).toBeInTheDocument();
    expect(screen.getByText(/^indexed$/i)).toBeInTheDocument();
  });

  it("deletes an indexed document", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documents: [
              {
                id: "doc-1",
                filename: "policy.txt",
                content_hash: "abc",
                size_bytes: 123,
                chunk_count: 2,
                created_at: "1700000000",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ deleted: true, document_id: "doc-1", chunk_count: 2 }), {
          status: 200,
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    render(<FilesTab />);

    expect(await screen.findByText("policy.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete policy.txt/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8090/knowledge/files/doc-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("policy.txt")).not.toBeInTheDocument();
    });
  });
});
