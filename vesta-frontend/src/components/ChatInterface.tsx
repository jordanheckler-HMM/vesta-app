import { useRef, useEffect, useState, useCallback } from "react";
import { ArrowDown } from "lucide-react";
import MessageBubble from "./MessageBubble";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  modelUsed?: string;
  sources?: RetrievedSource[];
}

export interface RetrievedSource {
  document_id: string;
  filename: string;
  chunk_index: number;
  score: number;
}

interface ChatInterfaceProps {
  messages: Message[];
  isLoading?: boolean;
  currentModel?: string | null;
  compact?: boolean;
}

const ChatInterface = ({ messages, isLoading, currentModel, compact = false }: ChatInterfaceProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const userScrollingRef = useRef(false); // Track if user is actively scrolling
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if user is near bottom of scroll area
  const checkIfNearBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    
    const threshold = 150; // pixels from bottom
    const isNearBottom = 
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    
    return isNearBottom;
  };

  // Handle manual scrolling
  const handleScroll = useCallback(() => {
    // User is actively scrolling
    userScrollingRef.current = true;
    
    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    const isNearBottom = checkIfNearBottom();
    setShouldAutoScroll(isNearBottom);
    
    // Show scroll button if user scrolled up and content is loading
    setShowScrollButton(!isNearBottom && isLoading);
    
    // Clear the scrolling flag after user stops scrolling
    scrollTimeoutRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 150);
  }, [isLoading]);

  // Auto-scroll with direct scrollTop manipulation (like ChatGPT)
  useEffect(() => {
    if (shouldAutoScroll && !userScrollingRef.current) {
      const container = scrollContainerRef.current;
      if (container) {
        // Use scrollTop for instant, precise control that doesn't fight user input
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages, shouldAutoScroll]);

  // Reset auto-scroll behavior when new message starts
  useEffect(() => {
    if (isLoading) {
      const isNearBottom = checkIfNearBottom();
      if (isNearBottom) {
        setShouldAutoScroll(true);
      }
    } else {
      // Hide scroll button when streaming completes
      setShowScrollButton(false);
    }
  }, [isLoading]);

  const scrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth"
      });
    }
    setShouldAutoScroll(true);
    setShowScrollButton(false);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className="flex-1 overflow-y-auto relative"
      ref={scrollContainerRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Conversation messages"
      aria-busy={isLoading || undefined}
    >
      <div className={`max-w-4xl mx-auto ${compact ? "px-3 py-3 pb-36" : "px-6 py-6 pb-48"}`}>
        {messages.length === 0 ? (
          <div className={`text-center ${compact ? "py-10" : "py-16"}`}>
            <p className={`text-muted-foreground ${compact ? "text-xs" : "text-sm"}`}>
              Start a conversation by typing below.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, index) => (
              <MessageBubble 
                key={msg.id} 
                role={msg.role} 
                content={msg.content}
                isStreaming={msg.role === "assistant" && msg.content === "" && isLoading}
                modelUsed={msg.role === "assistant" ? (msg.modelUsed || (index === messages.length - 1 ? currentModel : null)) : undefined}
                sources={msg.role === "assistant" ? msg.sources : undefined}
              />
            ))}
            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div
                className="flex items-center gap-2 text-sm text-muted-foreground py-3"
                role="status"
                aria-live="polite"
              >
                <div className="flex gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: "0ms" }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: "150ms" }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: "300ms" }} />
                </div>
                <span>Thinking…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      
      {/* Scroll to bottom button - appears when user scrolls up during streaming */}
      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          className={`fixed bg-primary text-primary-foreground 
                     rounded-full shadow-lg hover:shadow-xl transition-all
                     ${compact ? "bottom-32 right-4 p-2.5" : "bottom-44 right-8 p-3"}
                     animate-in fade-in slide-in-from-bottom-4 z-20`}
          aria-label="Scroll to latest message"
          title="Scroll to bottom"
        >
          <ArrowDown className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};

export default ChatInterface;
