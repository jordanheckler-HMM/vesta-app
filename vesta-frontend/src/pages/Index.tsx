import { useState, useRef } from "react";
import VestaHeader from "@/components/VestaHeader";
import ModeSelector, { ThinkingMode } from "@/components/ModeSelector";
import ModelSelector, { ModelType } from "@/components/ModelSelector";
import ChatInterface, { Message } from "@/components/ChatInterface";
import ChatInput from "@/components/ChatInput";
import VestaFooter from "@/components/VestaFooter";

const Index = () => {
  const [mode, setMode] = useState<ThinkingMode>("general");
  const [model, setModel] = useState<ModelType>("auto");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastModelUsed, setLastModelUsed] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleClearChat = () => {
    // Cancel any ongoing generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    setMessages([]);
    setIsLoading(false);
    setIsStreaming(false);
    setMode("general");
    setModel("auto");
    // VESTA compliance: Clear session-scoped state
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
    let fileContents: any[] = [];

    // Upload files first if any
    if (files && files.length > 0) {
      try {
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));
        
        const uploadResponse = await fetch("http://localhost:8000/upload", {
          method: "POST",
          body: formData,
        });
        
        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          fileContents = uploadData.files;
          
          // Add file context to message
          const fileList = fileContents.map(f => f.filename).join(", ");
          const fileDetails = fileContents
            .map(f => f.error 
              ? `--- ${f.filename} ---\nError: ${f.error}`
              : `--- ${f.filename} ---\n${f.content}`)
            .join("\n\n");
          
          messageContent = `${content}\n\n[Attached files: ${fileList}]\n\n${fileDetails}`.trim();
        } else {
          throw new Error("Failed to upload files");
        }
      } catch (error) {
        console.error("File upload error:", error);
        alert("Failed to upload files. Please try again.");
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

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    // Create a temporary assistant message for streaming
    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          message: messageContent,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          model,
          last_model_used: lastModelUsed,
        }),
        signal: abortControllerRef.current.signal,
      });
      
      // Extract routing metadata from response headers
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
          userFriendlyMessage = "Vesta cannot connect to the local AI service. Please check that the system is running.";
        } else if (response.status === 504) {
          userFriendlyMessage = "The request took too long. Please try again.";
        } else if (detail.includes("Ollama")) {
          userFriendlyMessage = "Vesta cannot reach the AI service. Please ensure the system is running.";
        }
        
        throw new Error(userFriendlyMessage);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const jsonData = JSON.parse(line.substring(6));
                
                if (jsonData.error) {
                  throw new Error(jsonData.error);
                }
                
                if (jsonData.content) {
                  accumulatedContent += jsonData.content;
                  
                  // Update the assistant message with accumulated content
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantId
                        ? { ...msg, content: accumulatedContent }
                        : msg
                    )
                  );
                }
                
                if (jsonData.done) {
                  // Add model info when streaming completes
                  if (selectedModel) {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantId
                          ? { ...msg, modelUsed: selectedModel }
                          : msg
                      )
                    );
                  }
                  break;
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      }

      setIsLoading(false);
      setIsStreaming(false);
    } catch (error) {
      // Check if error was from cancellation
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Generation cancelled by user');
        // Keep whatever content was streamed so far
      } else {
        // Update the assistant message with error for other errors
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: error instanceof Error ? error.message : "Vesta is unavailable right now.",
                }
              : msg
          )
        );
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <VestaHeader onClearChat={handleClearChat} />
      <ModeSelector selectedMode={mode} onModeChange={setMode} />
      <ModelSelector selectedModel={model} onModelChange={setModel} />
      <ChatInterface messages={messages} isLoading={isLoading} currentModel={currentModel} />
      
      {/* Fixed input area at bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-background">
        <ChatInput 
          onSend={handleSend} 
          onCancel={handleCancelGeneration}
          disabled={isLoading} 
          isStreaming={isStreaming}
        />
        <VestaFooter />
      </div>
    </div>
  );
};

export default Index;
