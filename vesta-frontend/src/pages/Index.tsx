import { useCallback, useEffect, useRef, useState } from "react";

import ChatInput from "@/components/ChatInput";
import ChatInterface, {
  Message,
  RetrievedSource,
} from "@/components/ChatInterface";
import ChatSidebar, {
  ConversationSummary,
  FolderSummary,
} from "@/components/ChatSidebar";
import FilesTab from "@/components/FilesTab";
import ModeSelector, { ThinkingMode } from "@/components/ModeSelector";
import ModelSelector, { ModelType } from "@/components/ModelSelector";
import ThemeSettingsTab from "@/components/ThemeSettingsTab";
import VestaFooter from "@/components/VestaFooter";
import VestaHeader from "@/components/VestaHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import type { FolderColorId } from "@/lib/folder-colors";
import { useAppTheme } from "@/hooks/use-app-theme";

const BACKEND_BASE_URL = "http://localhost:8090";

interface UploadedFile {
  filename: string;
  content?: string;
  error?: string;
}

interface UploadResponse {
  files: UploadedFile[];
}

interface ConversationMessageResponse {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  model_used?: string | null;
  sources?: RetrievedSource[];
  created_at: string;
}

interface ConversationDetailResponse {
  conversation: ConversationSummary;
  messages: ConversationMessageResponse[];
}

interface ConversationCreateResponse {
  conversation: ConversationSummary;
}

interface FolderResponse {
  folder: FolderSummary;
}

interface IndexProps {
  isMiniView?: boolean;
}

const Index = ({ isMiniView = false }: IndexProps) => {
  const { theme, setTheme } = useAppTheme();

  const [mode, setMode] = useState<ThinkingMode>("general");
  const [model, setModel] = useState<ModelType>("auto");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastModelUsed, setLastModelUsed] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "files" | "settings">("chat");

  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [activeConversationFolderId, setActiveConversationFolderId] = useState<
    string | null
  >(null);
  const [isSidebarLoading, setIsSidebarLoading] = useState(false);
  const [isConversationLoading, setIsConversationLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const initializedMainRef = useRef(false);

  const mapConversationMessagesToChat = (
    payloadMessages: ConversationMessageResponse[],
  ): Message[] => {
    return payloadMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      modelUsed: message.model_used || undefined,
      sources: message.sources || [],
    }));
  };

  const refreshSidebarData = useCallback(async (): Promise<
    ConversationSummary[] | null
  > => {
    if (isMiniView) {
      return null;
    }

    setIsSidebarLoading(true);
    try {
      const [foldersResponse, conversationsResponse] = await Promise.all([
        fetch(`${BACKEND_BASE_URL}/folders`),
        fetch(`${BACKEND_BASE_URL}/conversations`),
      ]);

      if (!foldersResponse.ok || !conversationsResponse.ok) {
        throw new Error("Failed to load sidebar data");
      }

      const foldersBody = await foldersResponse.json();
      const conversationsBody = await conversationsResponse.json();

      const nextFolders = (foldersBody.folders || []) as FolderSummary[];
      const nextConversations = (conversationsBody.conversations ||
        []) as ConversationSummary[];

      setFolders(nextFolders);
      setConversations(nextConversations);

      if (
        activeConversationId &&
        !nextConversations.some(
          (conversation) => conversation.id === activeConversationId,
        )
      ) {
        setActiveConversationId(null);
        setActiveConversationFolderId(null);
        setMessages([]);
      }

      return nextConversations;
    } catch (error) {
      console.error("Failed to load sidebar data", error);
      toast({
        variant: "destructive",
        title: "Could not load chats",
        description: "Make sure the backend is running and try again.",
      });
      return null;
    } finally {
      setIsSidebarLoading(false);
    }
  }, [activeConversationId, isMiniView]);

  const loadConversation = useCallback(
    async (conversationId: string) => {
      if (isMiniView) {
        return;
      }

      setIsConversationLoading(true);
      try {
        const response = await fetch(
          `${BACKEND_BASE_URL}/conversations/${conversationId}`,
        );
        if (!response.ok) {
          throw new Error("Failed to load conversation");
        }

        const body = (await response.json()) as ConversationDetailResponse;
        setActiveConversationId(body.conversation.id);
        setActiveConversationFolderId(body.conversation.folder_id || null);
        setMessages(mapConversationMessagesToChat(body.messages || []));
      } catch (error) {
        console.error("Failed to load conversation", error);
        toast({
          variant: "destructive",
          title: "Could not load chat",
          description: "Please try selecting the chat again.",
        });
      } finally {
        setIsConversationLoading(false);
      }
    },
    [isMiniView],
  );

  useEffect(() => {
    if (isMiniView || initializedMainRef.current) {
      return;
    }

    initializedMainRef.current = true;
    void (async () => {
      const loadedConversations = await refreshSidebarData();
      if (loadedConversations && loadedConversations.length > 0) {
        await loadConversation(loadedConversations[0].id);
      }
    })();
  }, [isMiniView, loadConversation, refreshSidebarData]);

  const resetChatState = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setMessages([]);
    setIsLoading(false);
    setIsStreaming(false);
    setMode("general");
    setModel("auto");
    setLastModelUsed(null);
    setCurrentModel(null);
  };

  const handleMiniClearChat = () => {
    resetChatState();
  };

  const startNewMainChat = (folderId: string | null = null) => {
    resetChatState();
    setActiveConversationId(null);
    setActiveConversationFolderId(folderId);
  };

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);
    }
  };

  const createConversationIfNeeded = async (): Promise<{
    conversationId: string;
    folderId: string | null;
  } | null> => {
    if (activeConversationId) {
      return {
        conversationId: activeConversationId,
        folderId: activeConversationFolderId,
      };
    }

    try {
      const response = await fetch(`${BACKEND_BASE_URL}/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ folder_id: activeConversationFolderId }),
      });

      if (!response.ok) {
        throw new Error("Failed to create conversation");
      }

      const body = (await response.json()) as ConversationCreateResponse;
      setActiveConversationId(body.conversation.id);
      setActiveConversationFolderId(body.conversation.folder_id || null);
      setConversations((prev) => {
        const filtered = prev.filter((item) => item.id !== body.conversation.id);
        return [body.conversation, ...filtered];
      });

      return {
        conversationId: body.conversation.id,
        folderId: body.conversation.folder_id || null,
      };
    } catch (error) {
      console.error("Failed to create conversation", error);
      toast({
        variant: "destructive",
        title: "Could not start chat",
        description: "Please try again.",
      });
      return null;
    }
  };

  const handleSend = async (content: string, files?: File[]) => {
    let messageContent = content;

    if (files && files.length > 0) {
      try {
        const formData = new FormData();
        files.forEach((file) => formData.append("files", file));

        const uploadResponse = await fetch(`${BACKEND_BASE_URL}/upload`, {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) {
          throw new Error("Failed to upload files");
        }

        const uploadData: UploadResponse = await uploadResponse.json();
        const fileList = uploadData.files.map((file) => file.filename).join(", ");
        const fileDetails = uploadData.files
          .map((file) =>
            file.error
              ? `--- ${file.filename} ---\nError: ${file.error}`
              : `--- ${file.filename} ---\n${file.content}`,
          )
          .join("\n\n");

        messageContent = `${content}\n\n[Attached files: ${fileList}]\n\n${fileDetails}`.trim();
      } catch (error) {
        console.error("File upload error:", error);
        toast({
          variant: "destructive",
          title: "File upload failed",
          description: "Please try again.",
        });
        return;
      }
    }

    let conversationContext: {
      conversationId: string;
      folderId: string | null;
    } | null = null;

    if (!isMiniView) {
      conversationContext = await createConversationIfNeeded();
      if (!conversationContext) {
        return;
      }
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: messageContent,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setIsStreaming(true);

    abortControllerRef.current = new AbortController();

    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, assistantMessage]);

    let accumulatedContent = "";
    let retrievedSources: RetrievedSource[] = [];
    let streamCompleted = false;
    let selectedModelHeader: string | null = null;

    try {
      const response = await fetch(`${BACKEND_BASE_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          message: messageContent,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          model,
          last_model_used: lastModelUsed,
          conversation_id: conversationContext?.conversationId,
          folder_id: conversationContext?.folderId ?? undefined,
        }),
        signal: abortControllerRef.current.signal,
      });

      selectedModelHeader = response.headers.get("X-Selected-Model");
      if (selectedModelHeader) {
        setCurrentModel(selectedModelHeader);
        setLastModelUsed(selectedModelHeader);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.detail || "Vesta is unavailable right now.";

        let userFriendlyMessage = "Vesta is unavailable right now.";

        if (response.status === 503) {
          userFriendlyMessage =
            "Vesta cannot connect to the local AI service. Please check that the system is running.";
        } else if (response.status === 504) {
          userFriendlyMessage = "The request took too long. Please try again.";
        } else if (detail.includes("Ollama")) {
          userFriendlyMessage =
            "Vesta cannot reach the AI service. Please ensure the system is running.";
        }

        throw new Error(userFriendlyMessage);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) {
              continue;
            }

            try {
              const jsonData = JSON.parse(line.substring(6));

              if (jsonData.error) {
                throw new Error(jsonData.error);
              }

              if (jsonData.metadata?.sources) {
                retrievedSources = jsonData.metadata.sources as RetrievedSource[];
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === assistantId
                      ? { ...message, sources: retrievedSources }
                      : message,
                  ),
                );
              }

              if (jsonData.content) {
                accumulatedContent += jsonData.content;

                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === assistantId
                      ? {
                          ...message,
                          content: accumulatedContent,
                          sources: retrievedSources,
                        }
                      : message,
                  ),
                );
              }

              if (jsonData.done) {
                streamCompleted = true;
                if (selectedModelHeader) {
                  setMessages((prev) =>
                    prev.map((message) =>
                      message.id === assistantId
                        ? {
                            ...message,
                            modelUsed: selectedModelHeader,
                            sources: retrievedSources,
                          }
                        : message,
                    ),
                  );
                }
                break;
              }
            } catch {
              // Skip malformed frames.
            }
          }
        }
      }

      if (
        !isMiniView &&
        streamCompleted &&
        conversationContext?.conversationId &&
        accumulatedContent.trim()
      ) {
        try {
          const saveTurnResponse = await fetch(
            `${BACKEND_BASE_URL}/conversations/${conversationContext.conversationId}/turns`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                user_message: messageContent,
                assistant_message: accumulatedContent,
                model_used: selectedModelHeader || undefined,
                sources: retrievedSources,
              }),
            },
          );

          if (!saveTurnResponse.ok) {
            throw new Error("Turn save failed");
          }

          const turnBody = await saveTurnResponse.json();
          const updatedConversation = turnBody.conversation as ConversationSummary;
          if (updatedConversation) {
            setConversations((prev) => {
              const filtered = prev.filter(
                (conversation) => conversation.id !== updatedConversation.id,
              );
              return [updatedConversation, ...filtered];
            });
            setActiveConversationFolderId(updatedConversation.folder_id || null);
          }

          await refreshSidebarData();
        } catch (saveError) {
          console.error("Failed to save conversation turn", saveError);
          toast({
            variant: "destructive",
            title: "Chat saved partially",
            description:
              "Response completed, but chat history could not be fully persisted.",
          });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Generation cancelled by user");
      } else {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content:
                    error instanceof Error
                      ? error.message
                      : "Vesta is unavailable right now.",
                }
              : message,
          ),
        );
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleCreateFolder = async (name: string, color: FolderColorId) => {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/folders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, color }),
      });

      if (response.status === 409) {
        toast({
          variant: "destructive",
          title: "Folder name already exists",
          description: "Choose a different folder name.",
        });
        throw new Error("Folder name already exists");
      }

      if (!response.ok) {
        throw new Error("Failed to create folder");
      }

      const body = (await response.json()) as FolderResponse;
      setFolders((prev) => [body.folder, ...prev]);
      await refreshSidebarData();
    } catch (error) {
      console.error("Failed to create folder", error);
      toast({
        variant: "destructive",
        title: "Could not create folder",
        description: "Please try again.",
      });
      throw error;
    }
  };

  const handleRenameFolder = async (
    folderId: string,
    name: string,
    color: FolderColorId,
  ) => {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/folders/${folderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, color }),
      });

      if (response.status === 409) {
        toast({
          variant: "destructive",
          title: "Folder name already exists",
          description: "Choose a different folder name.",
        });
        throw new Error("Folder name already exists");
      }

      if (!response.ok) {
        throw new Error("Failed to rename folder");
      }

      await refreshSidebarData();
    } catch (error) {
      console.error("Failed to rename folder", error);
      toast({
        variant: "destructive",
        title: "Could not rename folder",
        description: "Please try again.",
      });
      throw error;
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/folders/${folderId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete folder");
      }

      if (activeConversationFolderId === folderId) {
        startNewMainChat(null);
      }
      await refreshSidebarData();
    } catch (error) {
      console.error("Failed to delete folder", error);
      toast({
        variant: "destructive",
        title: "Could not delete folder",
        description: "Please try again.",
      });
    }
  };

  const handleRenameConversation = async (
    conversationId: string,
    title: string,
  ) => {
    try {
      const response = await fetch(
        `${BACKEND_BASE_URL}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title }),
        },
      );
      if (!response.ok) {
        throw new Error("Failed to rename conversation");
      }
      await refreshSidebarData();
    } catch (error) {
      console.error("Failed to rename conversation", error);
      toast({
        variant: "destructive",
        title: "Could not rename chat",
        description: "Please try again.",
      });
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      const response = await fetch(
        `${BACKEND_BASE_URL}/conversations/${conversationId}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to delete conversation");
      }

      if (activeConversationId === conversationId) {
        startNewMainChat(null);
      }
      await refreshSidebarData();
    } catch (error) {
      console.error("Failed to delete conversation", error);
      toast({
        variant: "destructive",
        title: "Could not delete chat",
        description: "Please try again.",
      });
    }
  };

  const handleMoveConversation = async (
    conversationId: string,
    folderId: string | null,
  ) => {
    try {
      const response = await fetch(
        `${BACKEND_BASE_URL}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ folder_id: folderId }),
        },
      );
      if (!response.ok) {
        throw new Error("Failed to move conversation");
      }

      if (activeConversationId === conversationId) {
        setActiveConversationFolderId(folderId);
      }
      await refreshSidebarData();
    } catch (error) {
      console.error("Failed to move conversation", error);
      toast({
        variant: "destructive",
        title: "Could not move chat",
        description: "Please try again.",
      });
    }
  };

  const chatPanel = (
    <>
      {isMiniView && (
        <>
          <ModeSelector selectedMode={mode} onModeChange={setMode} compact />
          <ModelSelector selectedModel={model} onModelChange={setModel} compact />
        </>
      )}

      <ChatInterface
        messages={messages}
        isLoading={isLoading || isConversationLoading}
        currentModel={currentModel}
        compact={isMiniView}
      />

      <div className="mt-auto">
        <ChatInput
          onSend={handleSend}
          onCancel={handleCancelGeneration}
          disabled={isLoading || isConversationLoading}
          isStreaming={isStreaming}
          compact={isMiniView}
          topContent={
            !isMiniView ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ModeSelector selectedMode={mode} onModeChange={setMode} inline />
                <ModelSelector
                  selectedModel={model}
                  onModelChange={setModel}
                  inline
                />
              </div>
            ) : undefined
          }
        />
        <VestaFooter compact={isMiniView} />
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <VestaHeader
        compact={isMiniView}
        onClearChat={isMiniView ? handleMiniClearChat : undefined}
        onNewChat={
          !isMiniView
            ? () => {
                startNewMainChat(null);
              }
            : undefined
        }
      />

      {isMiniView ? (
        chatPanel
      ) : (
        <div className="flex flex-1 min-h-0">
          <ChatSidebar
            folders={folders}
            conversations={conversations}
            activeConversationId={activeConversationId}
            loading={isSidebarLoading}
            onSelectConversation={loadConversation}
            onNewChat={(folderId) => startNewMainChat(folderId || null)}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onRenameConversation={handleRenameConversation}
            onDeleteConversation={handleDeleteConversation}
            onMoveConversation={handleMoveConversation}
          />

          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "chat" | "files" | "settings")
            }
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="border-b border-vesta-header-border bg-card">
              <div className="max-w-4xl mx-auto px-6 py-3">
                <TabsList>
                  <TabsTrigger value="chat">Chat</TabsTrigger>
                  <TabsTrigger value="files">Files</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
              </div>
            </div>

            <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-0">
              {chatPanel}
            </TabsContent>

            <TabsContent value="files" className="flex-1 mt-0 overflow-y-auto">
              <FilesTab
                folders={folders}
                defaultFolderId={activeConversationFolderId}
              />
            </TabsContent>

            <TabsContent value="settings" className="flex-1 mt-0 overflow-y-auto">
              <ThemeSettingsTab theme={theme} onThemeChange={setTheme} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
};

export default Index;
