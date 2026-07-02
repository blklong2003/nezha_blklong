export interface CommandPaletteCommand {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  icon?: "terminal" | "file" | "settings" | "search";
  run: () => void;
}

export interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  kind: "command" | "file";
  keywords?: string[];
  command?: CommandPaletteCommand;
  filePath?: string;
}
