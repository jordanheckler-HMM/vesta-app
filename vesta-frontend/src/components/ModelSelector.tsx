import { Zap, Cpu, Brain } from "lucide-react";

export type ModelType = "auto" | "lite" | "general" | "deep";

interface ModelSelectorProps {
  selectedModel: ModelType;
  onModelChange: (model: ModelType) => void;
  compact?: boolean;
}

const models: { id: ModelType; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "auto", label: "Auto", icon: <Zap className="w-4 h-4" />, description: "Smart routing" },
  { id: "lite", label: "Lite", icon: <Zap className="w-4 h-4" />, description: "Fast & simple" },
  { id: "general", label: "General", icon: <Cpu className="w-4 h-4" />, description: "Balanced" },
  { id: "deep", label: "Deep", icon: <Brain className="w-4 h-4" />, description: "Complex reasoning" },
];

const ModelSelector = ({ selectedModel, onModelChange, compact = false }: ModelSelectorProps) => {
  return (
    <div className="border-b border-vesta-header-border bg-card">
      <div className={`max-w-4xl mx-auto px-6 ${compact ? "py-2" : "py-3"}`}>
        <p className={`font-medium text-muted-foreground ${compact ? "text-[11px] mb-1.5" : "text-xs mb-2"}`}>
          Model Selection
        </p>
        <div
          className={`grid gap-2 ${compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}
          role="radiogroup"
          aria-label="Model selection"
        >
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={selectedModel === model.id}
              onClick={() => onModelChange(model.id)}
              className={`flex flex-col items-center ${compact ? "gap-0.5 px-2 py-1.5 text-[11px]" : "gap-1 px-3 py-2 text-xs"} rounded-md border transition-colors ${
                selectedModel === model.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              <span>{model.icon}</span>
              <span className="font-medium">{model.label}</span>
              {!compact && <span className="text-[10px] opacity-70">{model.description}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ModelSelector;
