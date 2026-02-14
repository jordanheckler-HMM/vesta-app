import { PenLine, Brain, Scale, MessageCircle } from "lucide-react";

export type ThinkingMode = "draft" | "think" | "clarify" | "general";

interface ModeSelectorProps {
  selectedMode: ThinkingMode;
  onModeChange: (mode: ThinkingMode) => void;
  compact?: boolean;
}

const modes: { id: ThinkingMode; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { id: "draft", label: "Draft or Rewrite", shortLabel: "Draft", icon: <PenLine className="w-4 h-4" /> },
  { id: "think", label: "Think Through a Problem", shortLabel: "Think", icon: <Brain className="w-4 h-4" /> },
  { id: "clarify", label: "Clarify a Decision", shortLabel: "Clarify", icon: <Scale className="w-4 h-4" /> },
  { id: "general", label: "General Question", shortLabel: "General", icon: <MessageCircle className="w-4 h-4" /> },
];

const ModeSelector = ({ selectedMode, onModeChange, compact = false }: ModeSelectorProps) => {
  return (
    <div className="border-b border-vesta-header-border bg-card">
      <div className={`max-w-4xl mx-auto px-6 ${compact ? "py-2.5" : "py-5"}`}>
        <p className={`font-medium text-foreground ${compact ? "text-xs mb-2" : "text-sm mb-3"}`}>
          {compact ? "Mode" : "What kind of thinking do you want to do?"}
        </p>
        <div
          className={`grid gap-2 ${compact ? "grid-cols-4" : "grid-cols-2 md:grid-cols-4"}`}
          role="radiogroup"
          aria-label="Thinking mode"
        >
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={selectedMode === mode.id}
              onClick={() => onModeChange(mode.id)}
              className={`vesta-mode-card flex items-center gap-2 text-left ${compact ? "text-xs py-2 px-2.5" : "text-sm"} ${
                selectedMode === mode.id ? "selected" : ""
              }`}
            >
              <span className="text-muted-foreground">{mode.icon}</span>
              <span className="text-secondary-foreground">{compact ? mode.shortLabel : mode.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ModeSelector;
