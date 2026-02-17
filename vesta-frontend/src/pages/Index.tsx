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
import SetupWizard from "@/components/SetupWizard";
import ThemeSettingsTab, {
  type ModelSettingsValues,
  type SetupPrerequisitesStatus,
} from "@/components/ThemeSettingsTab";
import WeatherTab, { type WeatherStatus } from "@/components/WeatherTab";
import VestaFooter from "@/components/VestaFooter";
import VestaHeader from "@/components/VestaHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import type { FolderColorId } from "@/lib/folder-colors";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useAutoUpdate } from "@/hooks/use-auto-update";

const BACKEND_BASE_URL = "http://localhost:8090";
const SETUP_WIZARD_SEEN_KEY = "vesta-setup-wizard-seen";

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

interface ModelSettingsResponse {
  configured_models: ModelSettingsValues;
  available_models: string[];
  ollama_connected: boolean;
}

interface SetupPrerequisitesRunResponse {
  approved: boolean;
  installed_ollama: boolean;
  started_ollama: boolean;
  pulled_models: string[];
  failed_models: { model: string; error: string }[];
  status: SetupPrerequisitesStatus;
  ready: boolean;
}

interface SetupFailedModel {
  model: string;
  error: string;
}

interface IndexProps {
  isMiniView?: boolean;
}

const Index = ({ isMiniView = false }: IndexProps) => {
  const { theme, setTheme } = useAppTheme();
  const { available: updateAvailable, version: updateVersion, downloading: updateDownloading, progress: updateProgress, startUpdate } = useAutoUpdate();

  const [mode, setMode] = useState<ThinkingMode>("general");
  const [model, setModel] = useState<ModelType>("auto");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastModelUsed, setLastModelUsed] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "chat" | "files" | "weather" | "settings"
  >("chat");
  const [weatherEnabled, setWeatherEnabled] = useState(false);

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
  const [modelSettings, setModelSettings] = useState<ModelSettingsValues | null>(
    null,
  );
  const [draftModelSettings, setDraftModelSettings] =
    useState<ModelSettingsValues | null>(null);
  const [availableOllamaModels, setAvailableOllamaModels] = useState<string[]>([]);
  const [isOllamaConnected, setIsOllamaConnected] = useState(true);
  const [isModelSettingsLoading, setIsModelSettingsLoading] = useState(false);
  const [isModelSettingsSaving, setIsModelSettingsSaving] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupPrerequisitesStatus | null>(
    null,
  );
  const [isSetupStatusLoading, setIsSetupStatusLoading] = useState(false);
  const [isSetupRunning, setIsSetupRunning] = useState(false);
  const [setupProgressSummary, setSetupProgressSummary] = useState("");
  const [setupModelProgress, setSetupModelProgress] = useState<
    Record<string, string>
  >({});
  const [setupFailedModels, setSetupFailedModels] = useState<SetupFailedModel[]>(
    [],
  );
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const initializedMainRef = useRef(false);
  const setupProgressTimingRef = useRef<
    Record<string, { lastCompleted: number; lastAt: number; rate: number }>
  >({});

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

  const loadWeatherStatus = useCallback(
    async (showErrorToast = false) => {
      if (isMiniView) {
        setWeatherEnabled(false);
        return;
      }

      try {
        const response = await fetch(`${BACKEND_BASE_URL}/weather/status`);
        if (!response.ok) {
          throw new Error("Failed to load weather status");
        }

        const body = (await response.json()) as WeatherStatus;
        setWeatherEnabled(Boolean(body.enabled));

        if (!body.enabled) {
          setActiveTab((current) => (current === "weather" ? "chat" : current));
        }
      } catch (error) {
        setWeatherEnabled(false);
        setActiveTab((current) => (current === "weather" ? "chat" : current));
        if (showErrorToast) {
          toast({
            variant: "destructive",
            title: "Could not load weather status",
            description: "Weather features are unavailable right now.",
          });
        }
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

  const loadModelSettings = useCallback(
    async (showErrorToast = false) => {
      if (isMiniView) {
        return;
      }

      setIsModelSettingsLoading(true);
      try {
        const response = await fetch(`${BACKEND_BASE_URL}/settings/models`);
        if (!response.ok) {
          throw new Error("Failed to load model settings");
        }

        const body = (await response.json()) as ModelSettingsResponse;
        setModelSettings(body.configured_models);
        setDraftModelSettings(body.configured_models);
        setAvailableOllamaModels(body.available_models || []);
        setIsOllamaConnected(body.ollama_connected !== false);
      } catch (error) {
        console.error("Failed to load model settings", error);
        if (showErrorToast) {
          toast({
            variant: "destructive",
            title: "Could not load model settings",
            description: "Please verify Ollama is running and try again.",
          });
        }
      } finally {
        setIsModelSettingsLoading(false);
      }
    },
    [isMiniView],
  );

  const loadSetupStatus = useCallback(
    async (showErrorToast = false) => {
      setIsSetupStatusLoading(true);
      try {
        const response = await fetch(`${BACKEND_BASE_URL}/setup/prerequisites`);
        if (!response.ok) {
          throw new Error("Failed to load setup status");
        }

        const body = (await response.json()) as SetupPrerequisitesStatus;
        setSetupStatus(body);
        setIsOllamaConnected(body.ollama_running);
        setAvailableOllamaModels(body.available_models || []);

        const baselineProgress: Record<string, string> = {};
        for (const modelName of body.required_models || []) {
          baselineProgress[modelName] = body.missing_models.includes(modelName)
            ? "pending"
            : "ready";
        }
        setSetupModelProgress(baselineProgress);
        if (body.ready) {
          setSetupFailedModels([]);
          setSetupProgressSummary("Local setup is ready.");
        }
      } catch (error) {
        console.error("Failed to load setup status", error);
        if (showErrorToast) {
          toast({
            variant: "destructive",
            title: "Could not load setup status",
            description: "Please verify the backend is running and try again.",
          });
        }
      } finally {
        setIsSetupStatusLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (isMiniView || activeTab !== "settings" || modelSettings) {
      return;
    }
    void loadModelSettings(false);
  }, [activeTab, isMiniView, loadModelSettings, modelSettings]);

  useEffect(() => {
    if (
      isMiniView ||
      activeTab !== "settings" ||
      setupStatus ||
      isSetupStatusLoading
    ) {
      return;
    }
    void loadSetupStatus(false);
  }, [activeTab, isMiniView, isSetupStatusLoading, loadSetupStatus, setupStatus]);

  useEffect(() => {
    void loadSetupStatus(false);
  }, [loadSetupStatus]);

  useEffect(() => {
    void loadWeatherStatus(false);
  }, [loadWeatherStatus]);

  useEffect(() => {
    if (isMiniView || isSetupStatusLoading || !setupStatus) {
      return;
    }

    if (setupStatus.ready) {
      setIsSetupWizardOpen(false);
      return;
    }

    const hasSeenWizard = window.localStorage.getItem(SETUP_WIZARD_SEEN_KEY);
    if (!hasSeenWizard) {
      window.localStorage.setItem(SETUP_WIZARD_SEEN_KEY, "1");
      setIsSetupWizardOpen(true);
    }
  }, [isMiniView, isSetupStatusLoading, setupStatus]);

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
    if (isSetupStatusLoading || !setupStatus?.ready) {
      if (!isMiniView) {
        setActiveTab("settings");
      }
      toast({
        variant: "destructive",
        title: "Complete local setup first",
        description:
          "Vesta needs Ollama and required models before chat is available.",
      });
      return;
    }

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

  const handleModelSettingChange = (
    profile: "lite" | "general" | "deep",
    modelName: string,
  ) => {
    setDraftModelSettings((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        [profile]: modelName,
      };
    });
  };

  const handleSaveModelSettings = async () => {
    if (!draftModelSettings) {
      return;
    }

    setIsModelSettingsSaving(true);
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/settings/models`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draftModelSettings),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
          errorBody.detail || "Failed to save model settings",
        );
      }

      const body = (await response.json()) as ModelSettingsResponse;
      setModelSettings(body.configured_models);
      setDraftModelSettings(body.configured_models);
      setAvailableOllamaModels(body.available_models || []);
      setIsOllamaConnected(body.ollama_connected !== false);
      toast({
        title: "Model mapping saved",
        description: "New Lite, General, and Deep models will be used for chat routing.",
      });
    } catch (error) {
      console.error("Failed to save model settings", error);
      toast({
        variant: "destructive",
        title: "Could not save model mapping",
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsModelSettingsSaving(false);
    }
  };

  const normalizeTargetModels = (models?: string[]): string[] => {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const rawModel of models || []) {
      const modelName = rawModel.trim();
      if (!modelName || seen.has(modelName)) {
        continue;
      }
      seen.add(modelName);
      normalized.push(modelName);
    }
    return normalized;
  };

  const formatEtaSeconds = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return "0s";
    }

    const rounded = Math.ceil(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;

    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    if (minutes > 0) {
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    return `${secs}s`;
  };

  const upsertFailedModel = (
    previous: SetupFailedModel[],
    failure: SetupFailedModel,
  ): SetupFailedModel[] => {
    const filtered = previous.filter((entry) => entry.model !== failure.model);
    return [...filtered, failure];
  };

  const handleRunPrerequisitesSetup = async (targetModels?: string[]) => {
    const normalizedTargetModels = normalizeTargetModels(targetModels);
    const isTargetedRetry = normalizedTargetModels.length > 0;
    const approved = window.confirm(
      isTargetedRetry
        ? `Vesta will retry downloading ${normalizedTargetModels.join(", ")}. Continue?`
        : "Vesta will try to install/start Ollama and download required Vesta models. Continue?",
    );
    if (!approved) {
      return;
    }

    setIsSetupRunning(true);
    setSetupProgressSummary(
      isTargetedRetry ? "Retrying selected models..." : "Starting setup...",
    );
    setSetupFailedModels((previous) => {
      if (!isTargetedRetry) {
        return [];
      }
      const remaining = new Set(normalizedTargetModels);
      return previous.filter((entry) => !remaining.has(entry.model));
    });
    setSetupModelProgress((prev) => {
      const reset = { ...prev };
      if (isTargetedRetry) {
        for (const modelName of normalizedTargetModels) {
          reset[modelName] = "pending";
        }
      } else {
        for (const key of Object.keys(reset)) {
          reset[key] = "pending";
        }
      }
      return reset;
    });
    if (isTargetedRetry) {
      for (const modelName of normalizedTargetModels) {
        delete setupProgressTimingRef.current[modelName];
      }
    } else {
      setupProgressTimingRef.current = {};
    }
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/setup/prerequisites/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          isTargetedRetry
            ? { approved: true, models: normalizedTargetModels }
            : { approved: true },
        ),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.detail || "Failed to run setup");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        throw new Error("Setup stream is unavailable right now.");
      }

      let buffer = "";
      let completePayload: SetupPrerequisitesRunResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .find((candidate) => candidate.startsWith("data: "));
          if (!line) {
            continue;
          }

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(6)) as Record<string, unknown>;
          } catch {
            continue;
          }
          const eventType = String(event.type || "");

          if (eventType === "error") {
            throw new Error(String(event.message || "Setup failed"));
          }

          if (eventType === "status" && event.status) {
            const status = event.status as SetupPrerequisitesStatus;
            setSetupStatus(status);
            setIsOllamaConnected(status.ollama_running);
            setAvailableOllamaModels(status.available_models || []);
            continue;
          }

          if (eventType === "target_models") {
            const targetModels = Array.isArray(event.target_models)
              ? event.target_models
                .map((value) => String(value).trim())
                .filter((value) => value.length > 0)
              : [];
            if (targetModels.length > 0) {
              setSetupModelProgress((prev) => {
                const next = { ...prev };
                for (const modelName of targetModels) {
                  next[modelName] = "pending";
                }
                return next;
              });
            }
            continue;
          }

          if (eventType === "install_start") {
            setSetupProgressSummary("Installing Ollama...");
            continue;
          }

          if (eventType === "install_done") {
            setSetupProgressSummary("Installed Ollama.");
            continue;
          }

          if (eventType === "start_ollama") {
            setSetupProgressSummary("Starting Ollama...");
            continue;
          }

          if (eventType === "start_ollama_done") {
            setSetupProgressSummary("Ollama is running.");
            continue;
          }

          if (eventType === "pull_start") {
            const modelName = String(event.model || "");
            if (modelName) {
              setSetupProgressSummary(`Downloading ${modelName}...`);
              setupProgressTimingRef.current[modelName] = {
                lastCompleted: 0,
                lastAt: Date.now(),
                rate: 0,
              };
              setSetupModelProgress((prev) => ({
                ...prev,
                [modelName]: "starting",
              }));
            }
            continue;
          }

          if (eventType === "pull_progress") {
            const modelName = String(event.model || "");
            if (!modelName) {
              continue;
            }

            const completed = Number(event.completed);
            const total = Number(event.total);
            const statusLabel =
              Number.isFinite(completed) &&
                Number.isFinite(total) &&
                total > 0
                ? (() => {
                  const now = Date.now();
                  const timing = setupProgressTimingRef.current[modelName] || {
                    lastCompleted: completed,
                    lastAt: now,
                    rate: 0,
                  };

                  if (completed > timing.lastCompleted && now > timing.lastAt) {
                    const deltaCompleted = completed - timing.lastCompleted;
                    const deltaSeconds = (now - timing.lastAt) / 1000;
                    if (deltaCompleted > 0 && deltaSeconds > 0) {
                      const instantRate = deltaCompleted / deltaSeconds;
                      timing.rate =
                        timing.rate > 0
                          ? timing.rate * 0.7 + instantRate * 0.3
                          : instantRate;
                    }
                    timing.lastCompleted = completed;
                    timing.lastAt = now;
                  }
                  setupProgressTimingRef.current[modelName] = timing;

                  const percent = Math.floor((completed / total) * 100);
                  const remaining = Math.max(0, total - completed);
                  const etaLabel =
                    timing.rate > 0 && remaining > 0
                      ? ` • ${formatEtaSeconds(remaining / timing.rate)} left`
                      : "";
                  return `${percent}%${etaLabel}`;
                })()
                : String(event.status || "downloading");

            setSetupModelProgress((prev) => ({
              ...prev,
              [modelName]: statusLabel,
            }));
            continue;
          }

          if (eventType === "pull_done") {
            const modelName = String(event.model || "");
            if (modelName) {
              delete setupProgressTimingRef.current[modelName];
              setSetupFailedModels((previous) =>
                previous.filter((entry) => entry.model !== modelName),
              );
              setSetupModelProgress((prev) => ({
                ...prev,
                [modelName]: "ready",
              }));
            }
            continue;
          }

          if (eventType === "pull_error") {
            const modelName = String(event.model || "");
            const errorLabel = String(event.error || "error");
            if (modelName) {
              delete setupProgressTimingRef.current[modelName];
              setSetupFailedModels((previous) =>
                upsertFailedModel(previous, { model: modelName, error: errorLabel }),
              );
              setSetupModelProgress((prev) => ({
                ...prev,
                [modelName]: `error: ${errorLabel}`,
              }));
            }
            continue;
          }

          if (eventType === "complete") {
            completePayload = event as unknown as SetupPrerequisitesRunResponse;
          }
        }
      }

      if (!completePayload) {
        throw new Error("Setup stream ended before completion.");
      }

      const body = completePayload;
      setSetupStatus(body.status);
      setIsOllamaConnected(body.status.ollama_running);
      setAvailableOllamaModels(body.status.available_models || []);
      setSetupFailedModels(body.failed_models || []);
      setIsSetupWizardOpen(!body.ready);

      if (body.ready) {
        const actionDetails: string[] = [];
        if (body.installed_ollama) {
          actionDetails.push("installed Ollama");
        }
        if (body.started_ollama) {
          actionDetails.push("started Ollama");
        }
        if (body.pulled_models.length > 0) {
          actionDetails.push(`pulled ${body.pulled_models.length} model(s)`);
        }

        const summaryText =
          actionDetails.length > 0
            ? `Vesta ${actionDetails.join(", ")}.`
            : "Ollama is ready and required models are available.";
        setSetupProgressSummary(summaryText);
        toast({
          title: "Setup complete",
          description: summaryText,
        });
      } else if (body.failed_models.length > 0) {
        const firstFailure = body.failed_models[0];
        const errorSummary = `${firstFailure.model}: ${firstFailure.error}`;
        setSetupProgressSummary(`Setup completed with errors: ${errorSummary}`);
        toast({
          variant: "destructive",
          title: "Setup completed with errors",
          description: errorSummary,
        });
      } else {
        setSetupProgressSummary("Setup ran, but some requirements are still pending.");
        toast({
          title: "Setup updated",
          description: "Setup ran, but some requirements are still pending.",
        });
      }

      await loadSetupStatus(false);
      await loadModelSettings(false);
    } catch (error) {
      console.error("Failed to run setup", error);
      setIsSetupWizardOpen(true);
      setSetupProgressSummary(
        error instanceof Error ? `Setup failed: ${error.message}` : "Setup failed.",
      );
      toast({
        variant: "destructive",
        title: "Setup failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsSetupRunning(false);
    }
  };

  const chatPanel = (
    <>
      {(isSetupStatusLoading || !setupStatus?.ready) && (
        <div className="mx-4 mt-4 rounded-md border border-vesta-header-border bg-card px-4 py-3">
          <p className="text-sm font-semibold text-foreground">
            Local setup required before chat
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isSetupStatusLoading
              ? "Checking local AI setup..."
              : "Vesta needs Ollama running and required models downloaded."}
          </p>
          {!isSetupStatusLoading && setupStatus && (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              {!setupStatus.ollama_installed ? (
                <p>Ollama is not installed.</p>
              ) : null}
              {setupStatus.ollama_installed && !setupStatus.ollama_running ? (
                <p>Ollama is installed but not running.</p>
              ) : null}
              {setupStatus.missing_models.length > 0 ? (
                <p>Missing models: {setupStatus.missing_models.join(", ")}</p>
              ) : null}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void handleRunPrerequisitesSetup();
              }}
              disabled={isSetupStatusLoading || isSetupRunning}
            >
              {isSetupRunning ? "Setting up..." : "Approve and set up"}
            </Button>
            {!isMiniView ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIsSetupWizardOpen(true)}
              >
                Open setup wizard
              </Button>
            ) : null}
            {!isMiniView ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setActiveTab("settings")}
              >
                Open settings
              </Button>
            ) : null}
          </div>
        </div>
      )}

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
          disabled={
            isLoading ||
            isConversationLoading ||
            isSetupStatusLoading ||
            !setupStatus?.ready
          }
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
        updateAvailable={updateAvailable}
        updateVersion={updateVersion}
        updateDownloading={updateDownloading}
        updateProgress={updateProgress}
        onUpdate={startUpdate}
      />

      {isMiniView ? (
        chatPanel
      ) : (
        <div className="flex flex-1 min-h-0">
          <div
            className="sidebar-hover-zone"
            style={{
              position: 'relative',
              zIndex: 30,
              flexShrink: 0,
            }}
          >
            {/* Invisible hover trigger along the left edge */}
            <div
              className="sidebar-trigger"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '180px',
                height: '100%',
                zIndex: 31,
              }}
            />
            <div
              className="sidebar-panel"
              style={{
                width: '288px',
                height: '100%',
                position: 'absolute',
                top: 0,
                left: 0,
                transform: 'translateX(-100%)',
                transition: 'transform 0.25s ease, opacity 0.25s ease, box-shadow 0.25s ease',
                opacity: 0,
                boxShadow: 'none',
                pointerEvents: 'none',
              }}
            >
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
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "chat" | "files" | "weather" | "settings")
            }
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="border-b border-vesta-header-border bg-card">
              <div className="max-w-4xl mx-auto px-6 py-3">
                <TabsList>
                  <TabsTrigger value="chat">Chat</TabsTrigger>
                  <TabsTrigger value="files">Files</TabsTrigger>
                  {weatherEnabled ? (
                    <TabsTrigger value="weather">Weather</TabsTrigger>
                  ) : null}
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
              </div>
            </div>

            <TabsContent value="chat" className="flex-1 min-h-0 mt-0">
              <div className="flex h-full min-h-0 flex-col">{chatPanel}</div>
            </TabsContent>

            <TabsContent value="files" className="flex-1 mt-0 overflow-y-auto">
              <FilesTab
                folders={folders}
                defaultFolderId={activeConversationFolderId}
              />
            </TabsContent>

            {weatherEnabled ? (
              <TabsContent value="weather" className="flex-1 mt-0 overflow-y-auto">
                <WeatherTab backendBaseUrl={BACKEND_BASE_URL} />
              </TabsContent>
            ) : null}

            <TabsContent value="settings" className="flex-1 mt-0 overflow-y-auto">
              <ThemeSettingsTab
                theme={theme}
                onThemeChange={setTheme}
                modelSettings={draftModelSettings}
                availableModels={availableOllamaModels}
                setupStatus={setupStatus}
                ollamaConnected={isOllamaConnected}
                loadingModels={isModelSettingsLoading}
                loadingSetupStatus={isSetupStatusLoading}
                savingModels={isModelSettingsSaving}
                runningSetup={isSetupRunning}
                setupProgressSummary={setupProgressSummary}
                setupModelProgress={setupModelProgress}
                onModelSettingChange={handleModelSettingChange}
                onSaveModelSettings={handleSaveModelSettings}
                onRefreshModels={() => loadModelSettings(true)}
                onRefreshSetupStatus={() => loadSetupStatus(true)}
                onRunPrerequisiteSetup={handleRunPrerequisitesSetup}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {!isMiniView ? (
        <SetupWizard
          isOpen={isSetupWizardOpen}
          setupStatus={setupStatus}
          loadingStatus={isSetupStatusLoading}
          runningSetup={isSetupRunning}
          progressSummary={setupProgressSummary}
          modelProgress={setupModelProgress}
          failedModels={setupFailedModels}
          onRunSetup={() => {
            void handleRunPrerequisitesSetup();
          }}
          onRetryModel={(modelName) => {
            void handleRunPrerequisitesSetup([modelName]);
          }}
          onRefreshStatus={() => {
            void loadSetupStatus(true);
          }}
          onClose={() => setIsSetupWizardOpen(false)}
        />
      ) : null}
    </div>
  );
};

export default Index;
