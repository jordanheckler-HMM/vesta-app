import { Button } from "@/components/ui/button";
import type { SetupPrerequisitesStatus } from "@/components/ThemeSettingsTab";

interface SetupWizardProps {
  isOpen: boolean;
  setupStatus: SetupPrerequisitesStatus | null;
  loadingStatus: boolean;
  runningSetup: boolean;
  progressSummary: string;
  modelProgress: Record<string, string>;
  failedModels: { model: string; error: string }[];
  onRunSetup: () => void;
  onRetryModel: (modelName: string) => void;
  onRefreshStatus: () => void;
  onClose: () => void;
}

const SetupWizard = ({
  isOpen,
  setupStatus,
  loadingStatus,
  runningSetup,
  progressSummary,
  modelProgress,
  failedModels,
  onRunSetup,
  onRetryModel,
  onRefreshStatus,
  onClose,
}: SetupWizardProps) => {
  if (!isOpen) {
    return null;
  }

  const requiredModels = setupStatus?.required_models || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-lg border border-vesta-header-border bg-card p-5 shadow-lg">
        <h2 className="text-xl font-semibold text-foreground">Set up local AI</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Vesta runs fully local. On first run it can install/start Ollama and download
          required models after your approval.
        </p>
        {requiredModels.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Required models: {requiredModels.join(", ")}
          </p>
        ) : null}

        <div className="mt-4 space-y-2 text-sm">
          <p className="text-foreground">
            {setupStatus?.ollama_installed ? "✓" : "•"} Ollama installed
          </p>
          <p className="text-foreground">
            {setupStatus?.ollama_running ? "✓" : "•"} Ollama running
          </p>
          <p className="text-foreground">
            {setupStatus?.missing_models?.length === 0 ? "✓" : "•"} Required local models
          </p>
        </div>

        {requiredModels.length > 0 ? (
          <div className="mt-4 rounded-md border border-vesta-header-border bg-background p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Model download progress
            </p>
            <div className="mt-2 space-y-1.5">
              {requiredModels.map((modelName) => (
                <div key={modelName} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-foreground">{modelName}</span>
                  <span className="text-muted-foreground">
                    {modelProgress[modelName] ||
                      (setupStatus?.missing_models?.includes(modelName)
                        ? "pending"
                        : "ready")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {loadingStatus ? (
          <p className="mt-4 text-xs text-muted-foreground">Checking setup status...</p>
        ) : progressSummary ? (
          <p className="mt-4 text-xs text-muted-foreground">{progressSummary}</p>
        ) : null}

        {failedModels.length > 0 ? (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">Failed models</p>
            <div className="mt-2 space-y-2">
              {failedModels.map((failure) => (
                <div
                  key={failure.model}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div>
                    <p className="text-xs font-medium text-foreground">{failure.model}</p>
                    <p className="text-[11px] text-muted-foreground">{failure.error}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRetryModel(failure.model)}
                    disabled={runningSetup}
                  >
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={onRunSetup}
            disabled={runningSetup || loadingStatus}
          >
            {runningSetup ? "Setting up..." : "Approve and set up"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onRefreshStatus}
            disabled={runningSetup || loadingStatus}
          >
            Refresh status
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={runningSetup}>
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SetupWizard;
