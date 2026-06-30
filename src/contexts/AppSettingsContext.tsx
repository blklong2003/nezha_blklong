import { createContext, useContext, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type {
  ThemeMode,
  ThemeVariant,
  TerminalFontSize,
  TaskDisplayWindow,
  FontFamily,
} from "../types";
function resolveThemeVariant(mode: ThemeMode, systemPrefersDark: boolean): ThemeVariant {
  if (mode === "system") return systemPrefersDark ? "midnight" : "light";
  return mode;
}

export interface AppSettings {
  themeVariant: ThemeVariant;
  themeMode: ThemeMode;
  systemPrefersDark: boolean;
  terminalFontSize: TerminalFontSize;
  taskDisplayWindow: TaskDisplayWindow;
  attentionBadge: boolean;
  uiFontFamily: FontFamily;
  monoFontFamily: FontFamily;
}

export interface AppSettingsActions {
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  setTerminalFontSize: (size: TerminalFontSize) => void;
  setTaskDisplayWindow: (window: TaskDisplayWindow) => void;
  setAttentionBadge: (enabled: boolean) => void;
  setUiFontFamily: (family: FontFamily) => void;
  setMonoFontFamily: (family: FontFamily) => void;
}

type AppSettingsContextValue = AppSettings & AppSettingsActions;

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function useAppSettings(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return ctx;
}

export function useAppSettingsValue(): AppSettings {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error("useAppSettingsValue must be used within AppSettingsProvider");
  const { setThemeMode, toggleTheme, setTerminalFontSize, setTaskDisplayWindow, setAttentionBadge, setUiFontFamily, setMonoFontFamily, ...settings } = ctx;
  return settings;
}

export function AppSettingsProvider({
  themeMode,
  systemPrefersDark,
  terminalFontSize,
  taskDisplayWindow,
  attentionBadge,
  uiFontFamily,
  monoFontFamily,
  onSetThemeMode,
  onSetTerminalFontSize,
  onSetTaskDisplayWindow,
  onSetAttentionBadge,
  onSetUiFontFamily,
  onSetMonoFontFamily,
  children,
}: {
  themeMode: ThemeMode;
  systemPrefersDark: boolean;
  terminalFontSize: TerminalFontSize;
  taskDisplayWindow: TaskDisplayWindow;
  attentionBadge: boolean;
  uiFontFamily: FontFamily;
  monoFontFamily: FontFamily;
  onSetThemeMode: (mode: ThemeMode) => void;
  onSetTerminalFontSize: (size: TerminalFontSize) => void;
  onSetTaskDisplayWindow: (window: TaskDisplayWindow) => void;
  onSetAttentionBadge: (enabled: boolean) => void;
  onSetUiFontFamily: (family: FontFamily) => void;
  onSetMonoFontFamily: (family: FontFamily) => void;
  children: ReactNode;
}) {
  const toggleTheme = useCallback(() => {
    const next: ThemeMode =
      themeMode === "dark" || themeMode === "midnight"
        ? "light"
        : themeMode === "light"
          ? "midnight"
          : systemPrefersDark
            ? "light"
            : "midnight";
    onSetThemeMode(next);
  }, [onSetThemeMode, themeMode, systemPrefersDark]);

  const themeVariant = useMemo(
    () => resolveThemeVariant(themeMode, systemPrefersDark),
    [themeMode, systemPrefersDark],
  );

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      themeVariant,
      themeMode,
      systemPrefersDark,
      terminalFontSize,
      taskDisplayWindow,
      attentionBadge,
      uiFontFamily,
      monoFontFamily,
      setThemeMode: onSetThemeMode,
      toggleTheme,
      setTerminalFontSize: onSetTerminalFontSize,
      setTaskDisplayWindow: onSetTaskDisplayWindow,
      setAttentionBadge: onSetAttentionBadge,
      setUiFontFamily: onSetUiFontFamily,
      setMonoFontFamily: onSetMonoFontFamily,
    }),
    [
      themeVariant,
      themeMode,
      systemPrefersDark,
      terminalFontSize,
      taskDisplayWindow,
      attentionBadge,
      uiFontFamily,
      monoFontFamily,
      onSetThemeMode,
      toggleTheme,
      onSetTerminalFontSize,
      onSetTaskDisplayWindow,
      onSetAttentionBadge,
      onSetUiFontFamily,
      onSetMonoFontFamily,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
