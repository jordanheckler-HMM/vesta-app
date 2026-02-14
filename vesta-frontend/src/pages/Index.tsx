import { useRef, useState } from "react";

import ChatInput from "@/components/ChatInput";
import ChatInterface, { Message, RetrievedSource } from "@/components/ChatInterface";
import FilesTab from "@/components/FilesTab";
import ModeSelector, { ThinkingMode } from "@/components/ModeSelector";
import ModelSelector, { ModelType } from "@/components/ModelSelector";
import VestaFooter from "@/components/VestaFooter";
import VestaHeader from "@/components/VestaHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";

interface UploadedFile {
  filename: string;
  content?: string;
  error?: string;
}

interface UploadResponse {
  files: UploadedFile[];
}

interface IndexProps {
  isMiniView?: boolean;
}

const Index = ({ isMiniView = false }: IndexProps) => {
  const [mode, setMode] = useState<ThinkingMode>("general");
  const [model, setModel] = useState<ModelType>("auto");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastModelUsed, setLastModelUsed] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "files">("chat");
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleClearChat = () => {
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

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);
    }
  };

  const handleSend = async (content: string, files?: File[]) => {
    let messageContent = content;

    if (files && files.length > 0) {
      try {
        const formData = new FormData();
        files.forEach((file) => formData.append("files", file));

        const uploadResponse = await fetch("http://localhost:8090/upload", {
          method: "POST",
          body: formData,
        });

        if (uploadResponse.ok) {
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
        } else {
          throw new Error("Failed to upload files");
        }
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

    try {
      const response = await fetch("http://localhost:8090/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          message: messageContent,
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
          model,
          last_model_used: lastModelUsed,
        }),
        signal: abortControllerRef.current.signal,
      });

      const selectedModel = response.headers.get("X-Selected-Model");
      if (selectedModel) {
        setCurrentModel(selectedModel);
        setLastModelUsed(selectedModel);
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
      let accumulatedContent = "";
      let retrievedSources: RetrievedSource[] = [];

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
                    message.id === assistantId ? { ...message, sources: retrievedSources } : message,
                  ),
                );
              }

              if (jsonData.content) {
                accumulatedContent += jsonData.content;

                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === assistantId
                      ? { ...message, content: accumulatedContent, sources: retrievedSources }
                      : message,
                  ),
                );
              }

              if (jsonData.done) {
                if (selectedModel) {
                  setMessages((prev) =>
                    prev.map((message) =>
                      message.id === assistantId
                        ? {
                            ...message,
                            modelUsed: selectedModel,
                            sources: retrievedSources,
                          }
                        : message,
                    ),
                  );
                }
                break;
              }
            } catch {
              // Skip invalid JSON frames.
            }
          }
        }
      }

      setIsLoading(false);
      setIsStreaming(false);
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

  const chatPanel = (
    <>
      <ModeSelector selectedMode={mode} onModeChange={setMode} compact={isMiniView} />
      <ModelSelector selectedModel={model} onModelChange={setModel} compact={isMiniView} />
      <ChatInterface
        messages={messages}
        isLoading={isLoading}
        currentModel={currentModel}
        compact={isMiniView}
      />
      <div className="mt-auto">
        <ChatInput
          onSend={handleSend}
          onCancel={handleCancelGeneration}
          disabled={isLoading}
          isStreaming={isStreaming}
          compact={isMiniView}
        />
        <VestaFooter compact={isMiniView} />
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <VestaHeader onClearChat={handleClearChat} compact={isMiniView} />

      {isMiniView ? (
        chatPanel
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "chat" | "files")}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="border-b border-vesta-header-border bg-card">
            <div className="max-w-4xl mx-auto px-6 py-3">
              <TabsList>
                <TabsTrigger value="chat">Chat</TabsTrigger>
                <TabsTrigger value="files">Files</TabsTrigger>
              </TabsList>
            </div>
          </div>

          <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-0">
            {chatPanel}
          </TabsContent>

          <TabsContent value="files" className="flex-1 mt-0 overflow-y-auto">
            <FilesTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default Index;
