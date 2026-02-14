import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatSidebar, { ConversationSummary, FolderSummary } from "./ChatSidebar";

const folders: FolderSummary[] = [
  {
    id: "folder-1",
    name: "Operations",
    color: "sage",
    created_at: "1700000000",
    updated_at: "1700000000",
    chat_count: 1,
    document_count: 2,
  },
];

const conversations: ConversationSummary[] = [
  {
    id: "conv-1",
    title: "General chat",
    folder_id: null,
    folder_name: null,
    created_at: "1700000000",
    updated_at: "1700000000",
    last_message_at: "1700000000",
    last_message_preview: "preview",
    message_count: 2,
  },
  {
    id: "conv-2",
    title: "Folder chat",
    folder_id: "folder-1",
    folder_name: "Operations",
    created_at: "1700000000",
    updated_at: "1700000000",
    last_message_at: "1700000000",
    last_message_preview: "preview",
    message_count: 2,
  },
];

afterEach(() => {
  cleanup();
});

describe("ChatSidebar", () => {
  it("renders grouped chats and triggers selection/new chat", () => {
    const onSelectConversation = vi.fn();
    const onNewChat = vi.fn();

    render(
      <ChatSidebar
        folders={folders}
        conversations={conversations}
        activeConversationId={null}
        onSelectConversation={onSelectConversation}
        onNewChat={onNewChat}
        onCreateFolder={vi.fn().mockResolvedValue(undefined)}
        onRenameFolder={vi.fn().mockResolvedValue(undefined)}
        onDeleteFolder={vi.fn().mockResolvedValue(undefined)}
        onRenameConversation={vi.fn().mockResolvedValue(undefined)}
        onDeleteConversation={vi.fn().mockResolvedValue(undefined)}
        onMoveConversation={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("General chat")).toBeInTheDocument();
    expect(screen.getByText("Folder chat")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(onNewChat).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: /general chat preview/i }));
    expect(onSelectConversation).toHaveBeenCalledWith("conv-1");
  });

  it("starts a folder-scoped new chat from folder heading", () => {
    const onNewChat = vi.fn();

    render(
      <ChatSidebar
        folders={folders}
        conversations={conversations}
        activeConversationId={null}
        onSelectConversation={vi.fn()}
        onNewChat={onNewChat}
        onCreateFolder={vi.fn().mockResolvedValue(undefined)}
        onRenameFolder={vi.fn().mockResolvedValue(undefined)}
        onDeleteFolder={vi.fn().mockResolvedValue(undefined)}
        onRenameConversation={vi.fn().mockResolvedValue(undefined)}
        onDeleteConversation={vi.fn().mockResolvedValue(undefined)}
        onMoveConversation={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^operations$/i }));
    expect(onNewChat).toHaveBeenCalledWith("folder-1");
  });

  it("creates a folder with selected color from add folder dialog", async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);

    render(
      <ChatSidebar
        folders={folders}
        conversations={conversations}
        activeConversationId={null}
        onSelectConversation={vi.fn()}
        onNewChat={vi.fn()}
        onCreateFolder={onCreateFolder}
        onRenameFolder={vi.fn().mockResolvedValue(undefined)}
        onDeleteFolder={vi.fn().mockResolvedValue(undefined)}
        onRenameConversation={vi.fn().mockResolvedValue(undefined)}
        onDeleteConversation={vi.fn().mockResolvedValue(undefined)}
        onMoveConversation={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    fireEvent.change(screen.getByLabelText(/folder name/i), {
      target: { value: "Finance" },
    });
    fireEvent.click(screen.getByRole("button", { name: /choose slate folder color/i }));
    fireEvent.click(screen.getByRole("button", { name: /create folder/i }));

    expect(onCreateFolder).toHaveBeenCalledWith("Finance", "slate");
  });
});
