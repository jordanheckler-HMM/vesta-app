import { useRef, useEffect } from "react";
import MessageBubble from "./MessageBubble";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatInterfaceProps {
  messages: Message[];
}

const ChatInterface = ({ messages }: ChatInterfaceProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">
              Start a conversation by typing below.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInterface;
