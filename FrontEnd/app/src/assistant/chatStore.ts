import type { AssistantChoice, AssistantProviderHealth } from "@/electron.d";
import { create } from "zustand";

export type ToolChip = { id: string; name: string; ok?: boolean; output?: string };

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      turn: number;
      text: string;
      tools: ToolChip[];
      error?: string;
      done: boolean;
      /** "fast-path" when no model was involved. */
      source?: string;
      durationMs?: number;
    };

/** A SessionEvent from the assistant package, as it arrives over IPC. */
export type ChatEvent = { type: string; source?: string; [key: string]: unknown };

type ChatStore = {
  items: ChatItem[];
  providers: AssistantProviderHealth[] | null;
  choice: AssistantChoice | null;
  status: "idle" | "starting" | "ready" | "error";
  statusText: string;
  addUser: (text: string) => void;
  beginTurn: (turn: number) => void;
  applyEvent: (turn: number, event: ChatEvent) => void;
  finishTurn: (turn: number, error?: string) => void;
  clear: () => void;
  setProviders: (providers: AssistantProviderHealth[]) => void;
  setChoice: (choice: AssistantChoice) => void;
  setStatus: (status: ChatStore["status"], statusText?: string) => void;
};

let counter = 0;
const nextId = () => `c${++counter}`;

function updateTurn(items: ChatItem[], turn: number, patch: (item: Extract<ChatItem, { kind: "assistant" }>) => Extract<ChatItem, { kind: "assistant" }>) {
  return items.map((item) => (item.kind === "assistant" && item.turn === turn ? patch(item) : item));
}

export const useChatStore = create<ChatStore>((set) => ({
  items: [],
  providers: null,
  choice: null,
  status: "idle",
  statusText: "",
  addUser: (text) => set((state) => ({ items: [...state.items, { kind: "user", id: nextId(), text }] })),
  beginTurn: (turn) =>
    set((state) =>
      state.items.some((item) => item.kind === "assistant" && item.turn === turn)
        ? state
        : { items: [...state.items, { kind: "assistant", id: nextId(), turn, text: "", tools: [], done: false }] },
    ),
  applyEvent: (turn, event) =>
    set((state) => {
      let items = state.items;
      if (!items.some((item) => item.kind === "assistant" && item.turn === turn)) {
        items = [...items, { kind: "assistant", id: nextId(), turn, text: "", tools: [], done: false }];
      }
      return {
        items: updateTurn(items, turn, (item) => {
          const source = typeof event.source === "string" ? event.source : item.source;
          switch (event.type) {
            case "text":
              return { ...item, source, text: item.text + String(event.delta ?? "") };
            case "tool_call":
              return { ...item, source, tools: [...item.tools, { id: String(event.id), name: String(event.name) }] };
            case "tool_result": {
              const id = String(event.id);
              const known = item.tools.some((tool) => tool.id === id);
              const tools = known
                ? item.tools.map((tool) => (tool.id === id ? { ...tool, ok: Boolean(event.ok), output: String(event.output ?? "") } : tool))
                : [...item.tools, { id, name: String(event.name ?? "tool"), ok: Boolean(event.ok), output: String(event.output ?? "") }];
              return { ...item, source, tools };
            }
            case "error":
              return { ...item, source, error: String(event.message ?? "Something went wrong.") };
            case "done":
              return { ...item, source, done: true, durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined };
            default:
              return item;
          }
        }),
      };
    }),
  finishTurn: (turn, error) => set((state) => ({ items: updateTurn(state.items, turn, (item) => ({ ...item, done: true, error: error ?? item.error })) })),
  clear: () => set({ items: [] }),
  setProviders: (providers) => set({ providers }),
  setChoice: (choice) => set({ choice }),
  setStatus: (status, statusText = "") => set({ status, statusText }),
}));
