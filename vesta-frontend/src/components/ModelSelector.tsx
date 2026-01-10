import { Zap, Cpu, Brain } from "lucide-react";

export type ModelType = "auto" | "lite" | "general" | "deep";

interface ModelSelectorProps {
  selectedModel: ModelType;
  onModelChange: (model: ModelType) => void;
}

const models: { id: ModelType; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "auto", label: "Auto", icon: <Zap className="w-4 h-4" />, description: "Smart routing" },
  { id: "lite", label: "Lite", icon: <Zap className="w-4 h-4" />, description: "Fast & simple" },
  { id: "general", label: "General", icon: <Cpu className="w-4 h-4" />, description: "Balanced" },
  { id: "deep", label: "Deep", icon: <Brain className="w-4 h-4" />, description: "Complex reasoning" },
];

const ModelSelector = ({ selectedModel, onModelChange }: ModelSelectorProps) => {
  return (
    <div className="border-b border-vesta-header-border bg-card">
      <div className="max-w-4xl mx-auto px-6 py-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Model Selection
        </p>
        <div className="grid grid-cols-4 gap-2">
          {models.map((model) => (
            <button
              key={model.id}
              onClick={() => onModelChange(model.id)}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-md border transition-colors text-xs ${
                selectedModel === model.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              <span>{model.icon}</span>
              <span className="font-medium">{model.label}</span>
              <span className="text-[10px] opacity-70">{model.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ModelSelector;
