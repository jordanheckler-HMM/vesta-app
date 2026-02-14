import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MessageBubble from "./MessageBubble";

describe("MessageBubble", () => {
  it("renders retrieval source labels for assistant messages", () => {
    render(
      <MessageBubble
        role="assistant"
        content="Here is your answer."
        sources={[
          {
            document_id: "doc-1",
            filename: "sop.txt",
            chunk_index: 0,
            score: 0.91,
          },
        ]}
      />,
    );

    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("sop.txt#0")).toBeInTheDocument();
  });
});
