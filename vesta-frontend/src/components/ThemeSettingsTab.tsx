import { useMemo } from "react";
import { Brush, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AppTheme } from "@/hooks/use-app-theme";

type ModelProfileKey = "lite" | "general" | "deep";

export interface ModelSettingsValues {
  lite: string;
  general: string;
  deep: string;
}

export interface SetupPrerequisitesStatus {
  ollama_installed: boolean;
  ollama_running: boolean;
  required_models: string[];
  available_models: string[];
  missing_models: string[];
  ready: boolean;
}

interface ThemeSettingsTabProps {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  modelSettings?: ModelSettingsValues | null;
  availableModels?: string[];
  setupStatus?: SetupPrerequisitesStatus | null;
  ollamaConnected?: boolean;
  loadingModels?: boolean;
  loadingSetupStatus?: boolean;
  savingModels?: boolean;
  runningSetup?: boolean;
  setupProgressSummary?: string;
  setupModelProgress?: Record<string, string>;
  onModelSettingChange?: (profile: ModelProfileKey, modelName: string) => void;
  onSaveModelSettings?: () => void | Promise<void>;
  onRefreshModels?: () => void | Promise<void>;
  onRefreshSetupStatus?: () => void | Promise<void>;
  onRunPrerequisiteSetup?: () => void | Promise<void>;
}

const options: { id: AppTheme; title: string; description: string }[] = [
  {
    id: "light",
    title: "Default Light",
    description: "Clean neutral look for everyday use.",
  },
  {
    id: "dark",
    title: "Dark Mode",
    description: "Low-glare dark UI for night or focused work.",
  },
  {
    id: "manila",
    title: "Manila Folder Mode",
    description: "Warm paper-style palette inspired by office folders.",
  },
];

const ThemeSettingsTab = ({
  theme,
  onThemeChange,
  modelSettings = null,
  availableModels = [],
  setupStatus = null,
  ollamaConnected = true,
  loadingModels = false,
  loadingSetupStatus = false,
  savingModels = false,
  runningSetup = false,
  setupProgressSummary = "",
  setupModelProgress = {},
  onModelSettingChange,
  onSaveModelSettings,
  onRefreshModels,
  onRefreshSetupStatus,
  onRunPrerequisiteSetup,
}: ThemeSettingsTabProps) => {
  const modelOptions = useMemo(() => {
    const entries = new Set<string>(availableModels);
    if (modelSettings) {
      entries.add(modelSettings.lite);
      entries.add(modelSettings.general);
      entries.add(modelSettings.deep);
    }
    return Array.from(entries).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [availableModels, modelSettings]);

  const renderModelSelect = (profile: ModelProfileKey, label: string) => (
    <div className="space-y-1.5">
      <label htmlFor={`model-select-${profile}`} className="text-xs font-medium text-foreground">
        {label}
      </label>
      <select
        id={`model-select-${profile}`}
        value={modelSettings?.[profile] ?? ""}
        onChange={(event) => onModelSettingChange?.(profile, event.target.value)}
        disabled={
          loadingModels ||
          savingModels ||
          modelOptions.length === 0 ||
          !modelSettings ||
          !onModelSettingChange
        }
        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {modelOptions.map((modelName) => (
          <option key={`${profile}-${modelName}`} value={modelName}>
            {modelName}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto w-full px-4 md:px-6 py-3 md:py-4 space-y-4">
      <div className="pb-1 border-b border-vesta-header-border">
        <h2 className="text-lg font-semibold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure appearance and local Ollama model routing for this app.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-3">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Brush className="w-4 h-4" />
            Appearance
          </h3>
          <p className="text-sm text-muted-foreground">
            Choose the app style. Changes apply to both main and mini chat windows.
          </p>

          <div
            role="radiogroup"
            aria-label="Appearance theme"
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1"
          >
            {options.map((option) => {
              const selected = theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onThemeChange(option.id)}
                  className={`rounded-md border px-4 py-3 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card hover:bg-accent text-foreground"
                  }`}
                >
                  <p className="text-sm font-semibold">{option.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">Local AI Setup</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Verify Ollama and install required Vesta models with your approval.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void onRefreshSetupStatus?.();
                }}
                disabled={loadingSetupStatus || runningSetup || !onRefreshSetupStatus}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Refresh status
              </Button>
            </div>

            {loadingSetupStatus ? (
              <p className="text-sm text-muted-foreground">Checking local setup...</p>
            ) : setupStatus ? (
              <div className="space-y-2">
                <p
                  className={`text-sm ${
                    setupStatus.ready ? "text-emerald-600" : "text-muted-foreground"
                  }`}
                >
                  {setupStatus.ready
                    ? "Local setup is ready."
                    : "Local setup is incomplete."}
                </p>
                {!setupStatus.ollama_installed ? (
                  <p className="text-xs text-destructive">
                    Ollama is not installed on this machine.
                  </p>
                ) : null}
                {setupStatus.ollama_installed && !setupStatus.ollama_running ? (
                  <p className="text-xs text-muted-foreground">
                    Ollama is installed but not running.
                  </p>
                ) : null}
                {setupStatus.missing_models.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Missing models: {setupStatus.missing_models.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Setup status is unavailable right now.
              </p>
            )}

            <Button
              type="button"
              onClick={() => {
                void onRunPrerequisiteSetup?.();
              }}
              disabled={runningSetup || !onRunPrerequisiteSetup}
            >
              {runningSetup ? "Setting up..." : "Approve and set up"}
            </Button>

            {setupProgressSummary ? (
              <p className="text-xs text-muted-foreground">{setupProgressSummary}</p>
            ) : null}

            {Object.keys(setupModelProgress).length > 0 ? (
              <div className="rounded-md border border-vesta-header-border bg-background p-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Per-model progress
                </p>
                <div className="mt-1.5 space-y-1 text-xs">
                  {Object.entries(setupModelProgress).map(([modelName, label]) => (
                    <div key={modelName} className="flex items-center justify-between gap-3">
                      <span className="text-foreground">{modelName}</span>
                      <span className="text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-vesta-header-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">Model Mapping</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose which Ollama models power Lite, General, and Deep routing.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void onRefreshModels?.();
                }}
                disabled={loadingModels || savingModels || !onRefreshModels}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Refresh models
              </Button>
            </div>

            {!ollamaConnected ? (
              <p className="text-xs text-destructive">
                Ollama model list is unavailable. Start Ollama and refresh models.
              </p>
            ) : null}

            {loadingModels ? (
              <p className="text-sm text-muted-foreground">Loading Ollama models...</p>
            ) : (
              <>
                {modelOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No Ollama models found. Pull models in Ollama, then refresh.
                  </p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-3">
                    {renderModelSelect("lite", "Lite model")}
                    {renderModelSelect("general", "General model")}
                    {renderModelSelect("deep", "Deep model")}
                  </div>
                )}

                <div>
                  <Button
                    type="button"
                    onClick={() => {
                      void onSaveModelSettings?.();
                    }}
                    disabled={
                      savingModels ||
                      loadingModels ||
                      modelOptions.length === 0 ||
                      !modelSettings ||
                      !onSaveModelSettings
                    }
                  >
                    {savingModels ? "Saving..." : "Save model mapping"}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default ThemeSettingsTab;
