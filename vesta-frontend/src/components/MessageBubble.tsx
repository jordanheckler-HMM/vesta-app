import ReactMarkdown from 'react-markdown';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  modelUsed?: string | null;
}

const MessageBubble = ({ role, content, isStreaming, modelUsed }: MessageBubbleProps) => {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  
  const getModelDisplay = (model: string | null | undefined) => {
    if (!model) return null;
    const displays = {
      "lite": { text: "Lite", color: "bg-blue-500/10 text-blue-600" },
      "general": { text: "General", color: "bg-green-500/10 text-green-600" },
      "deep": { text: "Deep", color: "bg-purple-500/10 text-purple-600" }
    };
    return displays[model as keyof typeof displays] || null;
  };
  
  const modelDisplay = getModelDisplay(modelUsed);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative max-w-[80%] px-4 py-3 rounded-lg text-sm leading-relaxed group ${
          isUser
            ? "bg-vesta-user text-primary-foreground whitespace-pre-wrap"
            : "bg-vesta-assistant text-muted-foreground"
        }`}
      >
        {/* Copy button */}
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 
                     group-focus-within:opacity-100 transition-opacity p-1.5 rounded bg-background/90 
                     hover:bg-background border border-border shadow-sm"
          aria-label="Copy message"
          title={copied ? "Copied!" : "Copy message"}
          disabled={isStreaming}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-600" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          )}
        </button>

        {isUser ? (
          content
        ) : (
          <div className="relative">
            <ReactMarkdown
              components={{
                // Paragraphs
                p: ({ node, ...props }) => <p className="mb-3 last:mb-0" {...props} />,
                // Unordered lists
                ul: ({ node, ...props }) => <ul className="mb-3 ml-4 list-disc space-y-1" {...props} />,
                // Ordered lists
                ol: ({ node, ...props }) => <ol className="mb-3 ml-4 list-decimal space-y-1" {...props} />,
                // List items
                li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                // Bold text
                strong: ({ node, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
                // Italic text
                em: ({ node, ...props }) => <em className="italic" {...props} />,
                // Inline code
                code: ({ node, ...props }) => <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props} />,
                // Headings
                h1: ({ node, ...props }) => <h1 className="text-base font-semibold mb-2 mt-4 first:mt-0 text-foreground" {...props} />,
                h2: ({ node, ...props }) => <h2 className="text-sm font-semibold mb-2 mt-3 first:mt-0 text-foreground" {...props} />,
                h3: ({ node, ...props }) => <h3 className="text-sm font-medium mb-2 mt-2 first:mt-0 text-foreground" {...props} />,
                // Links (if any)
                a: ({ node, ...props }) => <a className="underline hover:text-foreground" {...props} />,
                // Blockquotes
                blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-border pl-3 italic my-2" {...props} />,
              }}
            >
              {content || " "}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-foreground/70 animate-pulse ml-0.5" />
            )}
            {modelDisplay && !isStreaming && (
              <div className="flex justify-end mt-2">
                <span 
                  className={`text-xs px-2 py-0.5 rounded-full ${modelDisplay.color} font-medium`}
                  title={`Model: ${modelDisplay.text}`}
                >
                  {modelDisplay.text}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
