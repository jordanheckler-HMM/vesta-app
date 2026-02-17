import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";


interface VestaHeaderProps {
  onClearChat?: () => void;
  compact?: boolean;
}

const VestaHeader = ({ onClearChat, compact = false }: VestaHeaderProps) => {
  if (compact) {
    return (
      <header className="border-b border-vesta-header-border bg-card">
        <div className="max-w-4xl mx-auto px-3 py-2 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-semibold text-foreground tracking-tight">Vesta</h1>
            <p className="text-[11px] text-muted-foreground">Mini chat</p>
          </div>
          {onClearChat && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearChat}
              className="text-[11px] h-7 px-2 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-vesta-header-border bg-card">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            Vesta
          </h1>
          <p className="text-sm text-muted-foreground">
            Internal AI Assistant
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-vesta-status" />
          <span>Local • Session chat • Local files knowledge</span>
        </div>
      </div>
    </header>
  );
};

export default VestaHeader;
