import type { CommandPaletteCommand, CommandPaletteItem } from "./types";

export type CommandPaletteMode = "command" | "file";

export interface ParsedInput {
  mode: CommandPaletteMode;
  query: string;
}

const COMMAND_PREFIXES = [">", "："];

export function commandPaletteModeForInput(input: string): ParsedInput {
  const trimmed = input.trimStart();
  for (const prefix of COMMAND_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return { mode: "command", query: trimmed.slice(prefix.length).trim() };
    }
  }
  return { mode: "file", query: trimmed };
}

export function moveCommandPaletteSelection(
  current: number,
  delta: number,
  total: number,
): number {
  if (total === 0) return 0;
  return (current + delta + total) % total;
}

function fuzzyScore(text: string, query: string): number {
  if (!query) return 1;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Exact substring match gets highest score
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === 0) return 100;
  if (idx > 0) return 80 - idx;

  // Fuzzy match: all query chars appear in order
  let qi = 0;
  let score = 0;
  for (let i = 0; i < lowerText.length && qi < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[qi]) {
      score += 10 - i * 0.1;
      qi++;
    }
  }
  return qi === lowerQuery.length ? Math.max(score, 1) : 0;
}

export function rankCommandPaletteItems(
  items: CommandPaletteItem[],
  query: string,
  mode: CommandPaletteMode,
): CommandPaletteItem[] {
  const filtered = items.filter((item) => {
    if (!query) return true;
    const searchable = [
      item.title,
      item.subtitle ?? "",
      ...(item.keywords ?? []),
    ].join(" ");
    return fuzzyScore(searchable, query) > 0;
  });

  if (!query) return filtered;

  return filtered.sort((a, b) => {
    const scoreA = fuzzyScore(a.title, query);
    const scoreB = fuzzyScore(b.title, query);
    if (scoreB !== scoreA) return scoreB - scoreA;
    // Prefer commands in command mode
    if (mode === "command" && a.kind !== b.kind) {
      return a.kind === "command" ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

export function getRegisteredCommands(): CommandPaletteCommand[] {
  return [..._registeredCommands];
}

const _registeredCommands: CommandPaletteCommand[] = [];

export function registerCommand(command: CommandPaletteCommand): () => void {
  const existing = _registeredCommands.findIndex((c) => c.id === command.id);
  if (existing >= 0) {
    _registeredCommands[existing] = command;
  } else {
    _registeredCommands.push(command);
  }
  return () => {
    const idx = _registeredCommands.findIndex((c) => c.id === command.id);
    if (idx >= 0) _registeredCommands.splice(idx, 1);
  };
}

export function clearRegisteredCommands(): void {
  _registeredCommands.length = 0;
}
