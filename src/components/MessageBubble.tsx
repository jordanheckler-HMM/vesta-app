interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
}

const MessageBubble = ({ role, content }: MessageBubbleProps) => {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-4 py-3 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-vesta-user text-primary-foreground"
            : "bg-vesta-assistant text-muted-foreground"
        }`}
      >
        {content}
      </div>
    </div>
  );
};

export default MessageBubble;
