import { Brush } from "lucide-react";

import type { AppTheme } from "@/hooks/use-app-theme";

interface ThemeSettingsTabProps {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
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

const ThemeSettingsTab = ({ theme, onThemeChange }: ThemeSettingsTabProps) => {
  return (
    <div className="max-w-4xl mx-auto w-full px-6 py-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Brush className="w-4 h-4" />
          Appearance
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the app style. Changes apply to both main and mini chat windows.
        </p>
      </div>

      <div role="radiogroup" aria-label="Appearance theme" className="grid gap-3 md:grid-cols-3">
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
              <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ThemeSettingsTab;
