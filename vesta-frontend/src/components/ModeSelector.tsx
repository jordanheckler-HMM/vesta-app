import { PenLine, Brain, Scale, MessageCircle } from "lucide-react";

export type ThinkingMode = "draft" | "think" | "clarify" | "general";

interface ModeSelectorProps {
  selectedMode: ThinkingMode;
  onModeChange: (mode: ThinkingMode) => void;
}

const modes: { id: ThinkingMode; label: string; icon: React.ReactNode }[] = [
  { id: "draft", label: "Draft or Rewrite", icon: <PenLine className="w-4 h-4" /> },
  { id: "think", label: "Think Through a Problem", icon: <Brain className="w-4 h-4" /> },
  { id: "clarify", label: "Clarify a Decision", icon: <Scale className="w-4 h-4" /> },
  { id: "general", label: "General Question", icon: <MessageCircle className="w-4 h-4" /> },
];

const ModeSelector = ({ selectedMode, onModeChange }: ModeSelectorProps) => {
  return (
    <div className="border-b border-vesta-header-border bg-card">
      <div className="max-w-4xl mx-auto px-6 py-5">
        <p className="text-sm font-medium text-foreground mb-3">
          What kind of thinking do you want to do?
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {modes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => onModeChange(mode.id)}
              className={`vesta-mode-card flex items-center gap-2 text-left text-sm ${
                selectedMode === mode.id ? "selected" : ""
              }`}
            >
              <span className="text-muted-foreground">{mode.icon}</span>
              <span className="text-secondary-foreground">{mode.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ModeSelector;
