// pi-output-styles — named, cache-preserving output styles for OMP/Pi.
// Pure helpers are exported for unit testing.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { clearInterval as clearNodeInterval, setInterval as setNodeInterval } from "node:timers";
import { fileURLToPath } from "node:url";

export interface Style {
  name: string;
  description: string;
  body: string;
}

type NotifyType = "info" | "warning" | "error";

interface ExtensionUI {
  setStatus(key: string, text: string | undefined): void;
  setWidget(key: string, lines: string[] | undefined, options?: { placement: "aboveEditor" | "belowEditor" }): void;
  getEditorText(): string;
  notify(message: string, type?: NotifyType): void;
}

interface ExtensionContext {
  cwd: string;
  hasUI: boolean;
  ui: ExtensionUI;
  sessionManager: {
    getBranch(): SessionEntryLike[];
  };
}

interface BeforeAgentStartEvent {
  prompt: string;
  systemPrompt?: string[];
}

interface BeforeAgentStartResult {
  message?: StyleControlMessage;
}

interface AgentMessageLike {
  role: string;
  customType?: string;
  content?: unknown;
  display?: boolean;
  details?: unknown;
  timestamp?: number;
}

interface ContextEvent {
  messages: AgentMessageLike[];
}

interface ContextResult {
  messages?: AgentMessageLike[];
}

interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
  hint?: string;
}

type EventHandler<E, R = void> = (event: E, ctx: ExtensionContext) => R | void | Promise<R | void>;

interface ExtensionAPI {
  appendEntry(customType: string, data: unknown): void;
  on(
    event: "session_start" | "session_switch" | "session_branch" | "session_tree" | "session_shutdown",
    handler: EventHandler<unknown>,
  ): void;
  on(event: "before_agent_start", handler: EventHandler<BeforeAgentStartEvent, BeforeAgentStartResult>): void;
  on(event: "context", handler: EventHandler<ContextEvent, ContextResult>): void;
  registerCommand(
    name: string,
    def: {
      description: string;
      getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
      handler: (args: string, ctx: ExtensionContext) => void | Promise<void>;
    },
  ): void;
}

export function parseStyle(text: string, fallbackName: string): Style {
  let name = fallbackName;
  let description = "";
  let body = text;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (fm) {
    body = fm[2];
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
      if (key === "name" && value.length > 0) name = value;
      else if (key === "description") description = value;
    }
  }
  return { name, description, body: body.trim() };
}

export function discoverStyles(dirsLowToHigh: string[]): Map<string, Style> {
  const styles = new Map<string, Style>();
  for (const dir of dirsLowToHigh) {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      let text: string;
      try {
        text = readFileSync(join(dir, entry), "utf8");
      } catch {
        continue;
      }
      const style = parseStyle(text, entry.slice(0, -3));
      if (style.body.length === 0) continue;
      styles.set(style.name, style);
    }
  }
  return styles;
}

export function configHome(): string {
  return process.env.PI_OUTPUT_STYLES_HOME || join(homedir(), ".omp", "agent");
}

export function userStylesDir(): string {
  return join(configHome(), "output-styles");
}

export function projectStylesDir(cwd: string): string {
  return join(cwd, ".omp", "output-styles");
}

export function bundledStylesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "styles");
}

export interface StyleState {
  active?: string;
}

export function readState(file: string): StyleState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && "active" in parsed && typeof parsed.active === "string") {
      return { active: parsed.active };
    }
  } catch {
    // missing or malformed → empty
  }
  return {};
}

export function writeState(file: string, state: StyleState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

export function userStateFile(): string {
  return join(configHome(), "pi-output-styles.json");
}

export function projectStateFile(cwd: string): string {
  return join(cwd, ".omp", "pi-output-styles.json");
}

export function resolveActiveName(
  sessionActive: string | null,
  userState: StyleState,
  projectState: StyleState,
): string | null {
  return sessionActive ?? userState.active ?? projectState.active ?? null;
}

export type SessionSelection = { type: "inherit" } | { type: "off" } | { type: "style"; name: string };

export interface SessionEntryLike {
  id?: string;
  type: string;
  customType?: string;
  content?: unknown;
  details?: unknown;
  data?: unknown;
}

interface StyleControlDetails {
  version: 1;
  selection: SessionSelection;
  activeStyle: string | null;
}

export interface StyleControlMessage {
  customType: string;
  content: string;
  display: false;
  details: StyleControlDetails;
}

export const STYLE_CONTROL_MESSAGE_TYPE = "pi-output-style-control";
export const STYLE_SELECTION_ENTRY_TYPE = "pi-output-style-selection";

function copySelection(selection: SessionSelection): SessionSelection {
  return selection.type === "style" ? { type: "style", name: selection.name } : { type: selection.type };
}

function selectionFromDetails(details: unknown): SessionSelection | null {
  if (!details || typeof details !== "object" || !("version" in details) || details.version !== 1) return null;
  if (!("selection" in details) || !details.selection || typeof details.selection !== "object") return null;
  const selection = details.selection;
  if (!("type" in selection) || typeof selection.type !== "string") return null;
  if (selection.type === "inherit" || selection.type === "off") return { type: selection.type };
  if (selection.type === "style" && "name" in selection && typeof selection.name === "string") {
    return { type: "style", name: selection.name };
  }
  return null;
}

function sameSelection(left: SessionSelection | null, right: SessionSelection): boolean {
  if (!left || left.type !== right.type) return false;
  return left.type !== "style" || (right.type === "style" && left.name === right.name);
}

function isStyleControlEntry(entry: SessionEntryLike): boolean {
  return entry.type === "custom_message" && entry.customType === STYLE_CONTROL_MESSAGE_TYPE;
}

export function buildStyleControlMessage(selection: SessionSelection, style: Style | null): StyleControlMessage {
  const content = style
    ? `[pi-output-styles control]\nOutput style: ${style.name}\nThis control supersedes earlier pi-output-styles controls. Apply these instructions to subsequent responses until another pi-output-styles control appears:\n\n${style.body}`
    : "[pi-output-styles control]\nOutput style: off\nThis control supersedes earlier pi-output-styles controls. Do not apply instructions from earlier pi-output-styles control messages.";
  return {
    customType: STYLE_CONTROL_MESSAGE_TYPE,
    content,
    display: false,
    details: { version: 1, selection: copySelection(selection), activeStyle: style?.name ?? null },
  };
}

export function restoreSessionSelection(entries: readonly SessionEntryLike[]): SessionSelection {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const selection =
      entry.type === "custom" && entry.customType === STYLE_SELECTION_ENTRY_TYPE
        ? selectionFromDetails(entry.data)
        : isStyleControlEntry(entry)
          ? selectionFromDetails(entry.details)
          : null;
    if (selection) return selection;
  }
  return { type: "inherit" };
}

// Compaction and /clear reset the provider-visible context. Always require a
// control after the latest such boundary: local compaction may retain selected
// entries, while remote compaction can replace them with provider-owned
// history. Looking only after the boundary is correct for all paths and costs
// one style body per reset rather than one per turn.
function firstVisibleEntryIndex(entries: readonly SessionEntryLike[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === "compaction" || entries[i].type === "reset_boundary") return i + 1;
  }
  return 0;
}

export function shouldInjectStyleControl(
  entries: readonly SessionEntryLike[],
  message: StyleControlMessage,
): boolean {
  const firstVisible = firstVisibleEntryIndex(entries);
  for (let i = entries.length - 1; i >= firstVisible; i--) {
    const entry = entries[i];
    if (!isStyleControlEntry(entry)) continue;
    return entry.content !== message.content || !sameSelection(selectionFromDetails(entry.details), message.details.selection);
  }
  return true;
}

function hasStyleControl(entries: readonly SessionEntryLike[]): boolean {
  return entries.some(isStyleControlEntry);
}

export type PersistScope = "none" | "user" | "project";

export interface StyleCommandArgs {
  name: string | null;
  persist: PersistScope;
}

// Flags recognized by the /style command. parseStyleCommandArgs maps each to a
// persist scope; the command handler warns on any --flag NOT in this set.
// Keep this in sync with the flag handling in parseStyleCommandArgs.
const KNOWN_FLAGS = ["--save", "--global", "--project"];

// Reserved argument words that clear the active style instead of selecting one.
const OFF_WORDS: Record<string, true> = { off: true, none: true };

export function parseStyleCommandArgs(args: string): StyleCommandArgs {
  const tokens = args.trim().split(/\s+/).filter(t => t.length > 0);
  let name: string | null = null;
  let save = false;
  let project = false;
  for (const t of tokens) {
    if (t === "--save" || t === "--global") save = true;
    else if (t === "--project") project = true;
    else if (!t.startsWith("--") && name === null) name = t;
  }
  const persist: PersistScope = project ? "project" : save ? "user" : "none";
  return { name, persist };
}

const STATUS_KEY = "pi-output-styles";
const HINT_KEY = "pi-output-styles-hint";
// Persistent ghost hint shown below the editor while a `/style` command is
// being composed. OMP only renders inline usage ghost text for builtin
// commands, so this widget carries the same message for extension commands.
const STYLE_HINT_LINES = [
  "/style <name|off> [--save] [--project]",
  "persist: --save (user default, --global alias) · --project (this project)",
];

// Pure matcher for the widget: show the hint while the input starts with a
// `/style` command word (line start, with optional leading whitespace).
export function styleHintFor(text: string): string[] | null {
  return /^\s*\/style(?:\s|$)/.test(text) ? STYLE_HINT_LINES : null;
}

// Poller state: one started flag guards re-registration across in-process
// session restarts; lastHintInput dedupes widget updates against the text the
// hint was computed for.
let started = false;
let lastHintInput: string | null = null;
let stopHintPoller: (() => void) | null = null;

type IntervalHandle = ReturnType<typeof setNodeInterval>;
type IntervalScheduler = (callback: () => void, ms: number) => IntervalHandle;
type IntervalCanceller = (handle: IntervalHandle) => void;

// Debounced poller: only updates the widget once the input text is stable
// across a tick and differs from the last-checked text. Exported for tests.
export function startHintPoller(
  ctx: ExtensionContext,
  schedule: IntervalScheduler = setNodeInterval,
  cancel: IntervalCanceller = clearNodeInterval,
): () => void {
  let stableInput: string | null = null;
  const handle = schedule(() => {
    const text = ctx.ui.getEditorText();
    if (text !== stableInput) {
      stableInput = text;
      return;
    }
    const lines = styleHintFor(text);
    if (lines !== null && lastHintInput !== text) {
      ctx.ui.setWidget(HINT_KEY, lines, { placement: "belowEditor" });
      lastHintInput = text;
    } else if (lines === null && lastHintInput !== null) {
      ctx.ui.setWidget(HINT_KEY, undefined);
      lastHintInput = null;
    }
  }, 600);
  handle.unref?.();
  return () => cancel(handle);
}

function styleDirs(cwd: string): string[] {
  // low → high precedence: bundled < user < project
  return [bundledStylesDir(), userStylesDir(), projectStylesDir(cwd)];
}

// Argument completions for `/style <name>`: matches style names by prefix.
// getArgumentCompletions carries no ctx, so discovery uses process.cwd() as the
// project scope (best-effort; the command handler still uses ctx.cwd).
// Flags advertised as dim ghost text on every completion item, so users see
// that a style can be persisted beyond the session with --save (user default)
// or --project (per-project default). --global is accepted as a --save alias.
const FLAG_HINT = "[--save] [--project]";

export function styleCompletions(argumentPrefix: string, cwd: string): AutocompleteItem[] | null {
  if (argumentPrefix.includes(" ")) return null;
  const prefix = argumentPrefix.trim().toLowerCase();
  const styleItems: AutocompleteItem[] = [...discoverStyles(styleDirs(cwd)).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => ({ value: s.name, label: s.name, description: s.description || undefined, hint: FLAG_HINT }));
  const offItem: AutocompleteItem = {
    value: "off",
    label: "off",
    description: "Turn off styling for this session",
    hint: FLAG_HINT,
  };
  const items = [...styleItems, offItem].filter(i => i.value.toLowerCase().startsWith(prefix));
  return items.length > 0 ? items : null;
}

export function resolveActiveStyle(
  cwd: string,
  styles?: Map<string, Style>,
  selection: SessionSelection = { type: "inherit" },
): Style | null {
  if (selection.type === "off") return null;
  const sessionActive = selection.type === "style" ? selection.name : null;
  const name = resolveActiveName(
    sessionActive,
    readState(userStateFile()),
    readState(projectStateFile(cwd)),
  );
  if (!name) return null;
  const map = styles ?? discoverStyles(styleDirs(cwd));
  return map.get(name) ?? null;
}

function refreshStatus(ctx: ExtensionContext, style: Style | null): void {
  if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, style ? `style: ${style.name}` : undefined);
}

export default function outputStyles(pi: ExtensionAPI): void {
  let session: SessionSelection = { type: "inherit" };
  let contextControlKey = "";
  let contextControlTimestamp = Date.now();

  const restoreSession = (ctx: ExtensionContext): void => {
    session = restoreSessionSelection(ctx.sessionManager.getBranch());
    refreshStatus(ctx, resolveActiveStyle(ctx.cwd, undefined, session));
  };

  const recordSessionSelection = (): void => {
    pi.appendEntry(STYLE_SELECTION_ENTRY_TYPE, { version: 1, selection: copySelection(session) });
  };

  const preserveSessionSelectionAfterNavigation = (ctx: ExtensionContext): void => {
    if (session.type === "inherit") {
      restoreSession(ctx);
      return;
    }
    if (!sameSelection(restoreSessionSelection(ctx.sessionManager.getBranch()), session)) recordSessionSelection();
    refreshStatus(ctx, resolveActiveStyle(ctx.cwd, undefined, session));
  };

  pi.on("session_start", (_event, ctx) => {
    restoreSession(ctx);
    if (started || !ctx.hasUI) return;
    started = true;
    stopHintPoller = startHintPoller(ctx);
  });

  pi.on("session_switch", (_event, ctx) => restoreSession(ctx));
  pi.on("session_branch", (_event, ctx) => preserveSessionSelectionAfterNavigation(ctx));
  pi.on("session_tree", (_event, ctx) => preserveSessionSelectionAfterNavigation(ctx));
  pi.on("session_shutdown", () => {
    stopHintPoller?.();
    stopHintPoller = null;
    started = false;
    lastHintInput = null;
  });

  pi.on("before_agent_start", (_event, ctx) => {
    try {
      const entries = ctx.sessionManager.getBranch();
      const style = resolveActiveStyle(ctx.cwd, undefined, session);
      if (!style && session.type === "inherit" && !hasStyleControl(entries)) {
        refreshStatus(ctx, null);
        return;
      }
      const message = buildStyleControlMessage(session, style);
      refreshStatus(ctx, style);
      // before_agent_start custom messages are appended after the submitted
      // prompt, converted to provider-visible developer context, and persisted
      // by OMP/Pi. Reuse that history entry until a real transition occurs.
      if (!shouldInjectStyleControl(entries, message)) return;
      return { message };
    } catch {
      return; // never fail a turn over a styling concern
    }
  });

  // `context` runs after automatic compaction and before every provider call,
  // including tool-loop continuations. If compaction removed the persisted
  // control after `before_agent_start`, add one request-local copy so the style
  // never disappears for that call. The next user turn persists it normally.
  pi.on("context", (event, ctx) => {
    try {
      const entries = ctx.sessionManager.getBranch();
      const style = resolveActiveStyle(ctx.cwd, undefined, session);
      if (!style && session.type === "inherit" && !hasStyleControl(entries)) return;
      const control = buildStyleControlMessage(session, style);
      const contextEntries: SessionEntryLike[] = event.messages.map(message => ({
        type: message.role === "custom" ? "custom_message" : message.role,
        customType: message.customType,
        content: message.content,
        details: message.details,
      }));
      if (!shouldInjectStyleControl(contextEntries, control)) return;
      const key = `${control.content}\n${JSON.stringify(control.details.selection)}`;
      if (key !== contextControlKey) {
        contextControlKey = key;
        contextControlTimestamp = Date.now();
      }
      const message = { role: "custom", ...control, timestamp: contextControlTimestamp };
      // Insert before the current user turn rather than at the tail. The same
      // position survives later assistant/tool-result appends, so tool-loop
      // continuations retain a stable provider-cache prefix.
      const currentUser = event.messages.findLastIndex(item => item.role === "user");
      const compactionSummary = event.messages.findLastIndex(item => item.role === "compactionSummary");
      const insertionIndex = currentUser >= 0 ? currentUser : compactionSummary >= 0 ? compactionSummary + 1 : 0;
      return {
        messages: [
          ...event.messages.slice(0, insertionIndex),
          message,
          ...event.messages.slice(insertionIndex),
        ],
      };
    } catch {
      return;
    }
  });

  pi.registerCommand("style", {
    description: "Select a cache-preserving output style, or clear it. Usage: /style [name|off] [--save] [--project]",
    getArgumentCompletions: argumentPrefix => styleCompletions(argumentPrefix, process.cwd()),
    handler: (args, ctx) => {
      const { name, persist } = parseStyleCommandArgs(args);
      const styles = discoverStyles(styleDirs(ctx.cwd));
      const available = [...styles.keys()].sort().join(", ") || "(none)";

      const unknownFlags = args
        .trim()
        .split(/\s+/)
        .filter(t => t.startsWith("--") && !KNOWN_FLAGS.includes(t));
      if (unknownFlags.length > 0) {
        ctx.ui.notify(`Ignored unknown flag(s): ${unknownFlags.join(", ")}`, "warning");
      }

      if (!name) {
        const current = resolveActiveStyle(ctx.cwd, styles, session);
        const listing = [...styles.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(s => (s.description ? `${s.name} — ${s.description}` : s.name))
          .join("\n");
        ctx.ui.notify(`Active style: ${current?.name ?? "(none)"}\nAvailable:\n${listing || "(none)"}`, "info");
        return;
      }
      if (OFF_WORDS[name.toLowerCase()]) {
        session = { type: "off" };
        recordSessionSelection();
        let offScope = "this session";
        try {
          if (persist === "user") {
            writeState(userStateFile(), {});
            offScope = "cleared · user default";
          } else if (persist === "project") {
            writeState(projectStateFile(ctx.cwd), {});
            offScope = "cleared · project default";
          }
        } catch (err) {
          ctx.ui.notify(`Cleared for this session, but updating the saved default failed: ${String(err)}`, "warning");
        }
        refreshStatus(ctx, null);
        ctx.ui.notify(`Output style off (${offScope}).`, "info");
        return;
      }
      if (!styles.has(name)) {
        ctx.ui.notify(`Unknown style "${name}". Available: ${available}`, "error");
        return;
      }

      session = { type: "style", name };
      recordSessionSelection();
      let scope = "this session";
      try {
        if (persist === "user") {
          writeState(userStateFile(), { active: name });
          scope = "saved · user default";
        } else if (persist === "project") {
          writeState(projectStateFile(ctx.cwd), { active: name });
          scope = "saved · project default";
        }
      } catch (err) {
        ctx.ui.notify(`Applied for this session, but saving failed: ${String(err)}`, "warning");
      }
      refreshStatus(ctx, styles.get(name) ?? null);
      ctx.ui.notify(`Output style → "${name}" (${scope}).`, "info");
    },
  });
}
