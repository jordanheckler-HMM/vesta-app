import { useState } from "react";
import VestaHeader from "@/components/VestaHeader";
import ModeSelector, { ThinkingMode } from "@/components/ModeSelector";
import ChatInterface, { Message } from "@/components/ChatInterface";
import ChatInput from "@/components/ChatInput";
import VestaFooter from "@/components/VestaFooter";

const Index = () => {
  const [mode, setMode] = useState<ThinkingMode>("general");
  const [messages, setMessages] = useState<Message[]>([]);

  const handleSend = (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };

    setMessages((prev) => [...prev, userMessage]);

    // Simulated assistant response based on mode
    setTimeout(() => {
      const responses: Record<ThinkingMode, string> = {
        draft: `I'll help you draft or rewrite this. Here's a refined version:\n\n${content}\n\n→ Consider tightening the opening and making the call-to-action more specific.`,
        think: `Let me help you think through this problem step by step.\n\nFirst, let's identify the core issue: ${content.slice(0, 50)}...\n\nWhat constraints or requirements are you working with?`,
        clarify: `To clarify this decision, let's examine the key factors:\n\n1. What are the primary options you're considering?\n2. What criteria matter most for this decision?\n3. What's the timeline for deciding?`,
        general: `I understand you're asking about: "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"\n\nLet me provide a clear, direct answer.`,
      };

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: responses[mode],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    }, 800);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <VestaHeader />
      <ModeSelector selectedMode={mode} onModeChange={setMode} />
      <ChatInterface messages={messages} />
      <ChatInput onSend={handleSend} />
      <VestaFooter />
    </div>
  );
};

export default Index;
