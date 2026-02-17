import { useEffect, useState } from "react";

export type AppTheme = "light" | "dark" | "manila";

const THEME_STORAGE_KEY = "vesta-theme";

const normalizeTheme = (value: string | null): AppTheme => {
  if (value === "dark" || value === "light") {
    return value;
  }
  return "manila";
};

const applyThemeClass = (theme: AppTheme) => {
  const root = document.documentElement;
  root.classList.remove("dark", "manila");

  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "manila") {
    root.classList.add("manila");
  }
};

export const useAppTheme = () => {
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") {
      return "manila";
    }
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  });

  useEffect(() => {
    applyThemeClass(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        setTheme(normalizeTheme(event.newValue));
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { theme, setTheme };
};
