import { useMemo, useState } from "react";
import {
  FolderPlus,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DEFAULT_FOLDER_COLOR,
  FOLDER_COLOR_OPTIONS,
  FolderColorId,
  getFolderDotStyle,
  getFolderLabelStyle,
  normalizeFolderColor,
} from "@/lib/folder-colors";

export interface FolderSummary {
  id: string;
  name: string;
  color?: string;
  created_at: string;
  updated_at: string;
  chat_count: number;
  document_count: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  folder_id?: string | null;
  folder_name?: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  last_message_preview: string;
  message_count: number;
}

interface ChatSidebarProps {
  folders: FolderSummary[];
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  loading?: boolean;
  onSelectConversation: (conversationId: string) => void;
  onNewChat: (folderId?: string | null) => void;
  onCreateFolder: (name: string, color: FolderColorId) => Promise<void>;
  onRenameFolder: (
    folderId: string,
    name: string,
    color: FolderColorId,
  ) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onRenameConversation: (conversationId: string, title: string) => Promise<void>;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  onMoveConversation: (
    conversationId: string,
    folderId: string | null,
  ) => Promise<void>;
}

const ChatSidebar = ({
  folders,
  conversations,
  activeConversationId,
  loading = false,
  onSelectConversation,
  onNewChat,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameConversation,
  onDeleteConversation,
  onMoveConversation,
}: ChatSidebarProps) => {
  const [folderPendingDelete, setFolderPendingDelete] =
    useState<FolderSummary | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState<"create" | "edit">(
    "create",
  );
  const [folderEditing, setFolderEditing] = useState<FolderSummary | null>(null);
  const [folderNameInput, setFolderNameInput] = useState("");
  const [folderColorInput, setFolderColorInput] = useState<FolderColorId>(
    DEFAULT_FOLDER_COLOR,
  );
  const [isSavingFolder, setIsSavingFolder] = useState(false);
  const [folderNameError, setFolderNameError] = useState<string | null>(null);

  const uncategorizedConversations = useMemo(
    () => conversations.filter((conversation) => !conversation.folder_id),
    [conversations],
  );

  const folderConversationMap = useMemo(() => {
    const map = new Map<string, ConversationSummary[]>();
    folders.forEach((folder) => {
      map.set(
        folder.id,
        conversations.filter((conversation) => conversation.folder_id === folder.id),
      );
    });
    return map;
  }, [folders, conversations]);

  const openCreateFolderDialog = () => {
    setFolderDialogMode("create");
    setFolderEditing(null);
    setFolderNameInput("");
    setFolderColorInput(DEFAULT_FOLDER_COLOR);
    setFolderNameError(null);
    setFolderDialogOpen(true);
  };

  const openEditFolderDialog = (folder: FolderSummary) => {
    setFolderDialogMode("edit");
    setFolderEditing(folder);
    setFolderNameInput(folder.name);
    setFolderColorInput(normalizeFolderColor(folder.color));
    setFolderNameError(null);
    setFolderDialogOpen(true);
  };

  const closeFolderDialog = (open: boolean) => {
    if (!open && isSavingFolder) {
      return;
    }
    setFolderDialogOpen(open);
    if (!open) {
      setFolderNameError(null);
    }
  };

  const handleSaveFolder = async () => {
    const normalized = folderNameInput.trim();
    if (!normalized) {
      setFolderNameError("Project name is required.");
      return;
    }

    if (
      folderDialogMode === "edit" &&
      folderEditing &&
      normalized === folderEditing.name &&
      folderColorInput === normalizeFolderColor(folderEditing.color)
    ) {
      setFolderDialogOpen(false);
      return;
    }

    setIsSavingFolder(true);
    try {
      if (folderDialogMode === "create") {
        await onCreateFolder(normalized, folderColorInput);
      } else if (folderEditing) {
        await onRenameFolder(folderEditing.id, normalized, folderColorInput);
      }
      setFolderDialogOpen(false);
      setFolderNameError(null);
    } catch {
      // Keep dialog open so the user can fix input after API errors.
    } finally {
      setIsSavingFolder(false);
    }
  };

  const handleRenameConversation = async (conversation: ConversationSummary) => {
    const nextTitle = window.prompt("Rename chat", conversation.title);
    if (!nextTitle) return;
    const normalized = nextTitle.trim();
    if (!normalized || normalized === conversation.title) return;
    await onRenameConversation(conversation.id, normalized);
  };

  const confirmDeleteFolder = async () => {
    if (!folderPendingDelete) return;
    setIsDeletingFolder(true);
    try {
      await onDeleteFolder(folderPendingDelete.id);
      setFolderPendingDelete(null);
    } finally {
      setIsDeletingFolder(false);
    }
  };

  const renderConversationRow = (conversation: ConversationSummary) => {
    const isActive = activeConversationId === conversation.id;

    return (
      <div
        key={conversation.id}
        className={`group flex items-center gap-1 rounded-md border ${
          isActive
            ? "border-primary bg-primary/10"
            : "border-transparent hover:border-border hover:bg-accent/60"
        }`}
      >
        <button
          type="button"
          className="flex-1 text-left px-2 py-1.5 min-w-0"
          onClick={() => onSelectConversation(conversation.id)}
          title={conversation.title}
        >
          <p className="text-xs font-medium text-foreground truncate">
            {conversation.title}
          </p>
          {conversation.last_message_preview ? (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {conversation.last_message_preview}
            </p>
          ) : null}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 mr-1 text-muted-foreground opacity-0 group-hover:opacity-100"
              aria-label={`Chat actions for ${conversation.title}`}
              title="Chat actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => handleRenameConversation(conversation)}>
              <Pencil className="w-3.5 h-3.5 mr-2" />
              Rename chat
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem
                  onClick={() => onMoveConversation(conversation.id, null)}
                >
                  Uncategorized
                </DropdownMenuItem>
                {folders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onClick={() => onMoveConversation(conversation.id, folder.id)}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2 border"
                      style={{
                        ...getFolderDotStyle(folder.color),
                        borderColor:
                          getFolderLabelStyle(folder.color).borderColor,
                      }}
                    />
                    {folder.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDeleteConversation(conversation.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Delete chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <>
      <aside className="w-72 border-r border-vesta-header-border bg-card flex flex-col min-h-0">
        <div className="p-3 border-b border-vesta-header-border">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              className="flex-1"
              size="sm"
              onClick={() => onNewChat(null)}
            >
              <MessageSquarePlus className="w-4 h-4 mr-1.5" />
              New chat
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openCreateFolderDialog}
              aria-label="Add project"
              title="Add project"
            >
              <FolderPlus className="w-4 h-4 mr-1.5" />
              Add project
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {loading && conversations.length === 0 && folders.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-2">
              Loading chats...
            </p>
          ) : null}

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground px-1 mb-1.5">
              Uncategorized
            </p>
            <div className="space-y-1">
              {uncategorizedConversations.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-1 py-1">
                  No uncategorized chats.
                </p>
              ) : (
                uncategorizedConversations.map(renderConversationRow)
              )}
            </div>
          </div>

          {folders.map((folder) => {
            const items = folderConversationMap.get(folder.id) || [];
            return (
              <div key={folder.id}>
                <div className="flex items-center justify-between px-1 mb-1.5">
                  <button
                    type="button"
                    className="text-[11px] font-medium tracking-wide truncate"
                    title={folder.name}
                    onClick={() => onNewChat(folder.id)}
                  >
                    <span
                      className="inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5"
                      style={getFolderLabelStyle(folder.color)}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full border"
                        style={{
                          ...getFolderDotStyle(folder.color),
                          borderColor:
                            getFolderLabelStyle(folder.color).borderColor,
                        }}
                      />
                      {folder.name}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground"
                        aria-label={`Folder actions for ${folder.name}`}
                        title="Folder actions"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => onNewChat(folder.id)}>
                        <MessageSquarePlus className="w-3.5 h-3.5 mr-2" />
                        New chat in folder
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEditFolderDialog(folder)}>
                        <Pencil className="w-3.5 h-3.5 mr-2" />
                        Edit project
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setFolderPendingDelete(folder)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Delete folder
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="space-y-1">
                  {items.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground px-1 py-1">
                      No chats in this folder.
                    </p>
                  ) : (
                    items.map(renderConversationRow)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <Dialog open={folderDialogOpen} onOpenChange={closeFolderDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {folderDialogMode === "create" ? "Add project" : "Edit project"}
            </DialogTitle>
            <DialogDescription>
              Choose a project name and label color.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name-input">Project name</Label>
              <Input
                id="folder-name-input"
                value={folderNameInput}
                onChange={(event) => {
                  setFolderNameInput(event.target.value);
                  if (folderNameError) {
                    setFolderNameError(null);
                  }
                }}
                maxLength={120}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSaveFolder();
                  }
                }}
              />
              {folderNameError ? (
                <p className="text-xs text-destructive">{folderNameError}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Label color</Label>
              <div className="grid grid-cols-3 gap-2">
                {FOLDER_COLOR_OPTIONS.map((option) => {
                  const selected = folderColorInput === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setFolderColorInput(option.id)}
                      className={`rounded-md border px-2 py-2 text-xs text-left transition-colors ${
                        selected
                          ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                          : "hover:opacity-90"
                      }`}
                      style={getFolderLabelStyle(option.id)}
                      aria-label={`Choose ${option.label} folder color`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full border"
                          style={{
                            ...getFolderDotStyle(option.id),
                            borderColor:
                              getFolderLabelStyle(option.id).borderColor,
                          }}
                        />
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeFolderDialog(false)}
              disabled={isSavingFolder}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveFolder()}
              disabled={isSavingFolder}
            >
              {isSavingFolder
                ? "Saving..."
                : folderDialogMode === "create"
                  ? "Create project"
                  : "Save project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={folderPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingFolder) {
            setFolderPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              {folderPendingDelete
                ? `This will delete "${folderPendingDelete.name}", ${folderPendingDelete.chat_count} chat(s), and ${folderPendingDelete.document_count} document(s). This cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingFolder}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteFolder}
              disabled={isDeletingFolder}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingFolder ? "Deleting..." : "Delete folder"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ChatSidebar;
