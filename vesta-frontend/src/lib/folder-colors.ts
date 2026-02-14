export const FOLDER_COLOR_OPTIONS = [
  { id: "sand", label: "Sand" },
  { id: "stone", label: "Stone" },
  { id: "sage", label: "Sage" },
  { id: "slate", label: "Slate" },
  { id: "taupe", label: "Taupe" },
  { id: "clay", label: "Clay" },
] as const;

export type FolderColorId = (typeof FOLDER_COLOR_OPTIONS)[number]["id"];

export const DEFAULT_FOLDER_COLOR: FolderColorId = "sand";

const FOLDER_COLOR_SET = new Set<FolderColorId>(
  FOLDER_COLOR_OPTIONS.map((option) => option.id),
);

export const normalizeFolderColor = (
  color: string | null | undefined,
): FolderColorId => {
  if (!color) {
    return DEFAULT_FOLDER_COLOR;
  }
  const normalized = color.toLowerCase().trim() as FolderColorId;
  return FOLDER_COLOR_SET.has(normalized) ? normalized : DEFAULT_FOLDER_COLOR;
};

export const getFolderLabelStyle = (color: string | null | undefined) => {
  const normalized = normalizeFolderColor(color);
  return {
    backgroundColor: `hsl(var(--folder-${normalized}-bg))`,
    borderColor: `hsl(var(--folder-${normalized}-border))`,
    color: `hsl(var(--folder-${normalized}-text))`,
  };
};

export const getFolderDotStyle = (color: string | null | undefined) => {
  const normalized = normalizeFolderColor(color);
  return {
    backgroundColor: `hsl(var(--folder-${normalized}-dot))`,
  };
};
