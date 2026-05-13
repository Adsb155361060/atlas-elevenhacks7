/**
 * Atlas tool registry — single source of truth.
 *
 * Each tool declares:
 *   - `name`              — stable identifier the LLM uses to call it
 *   - `description`       — speak to Claude in second person; describe *when* to call, not just what
 *   - `location`          — 'cloud' (Worker executes) or 'desktop' (frontend executes via Conv-AI `client_tool_call`)
 *   - `confirm_required`  — Claude must confirm aloud before invoking (system prompt enforces this)
 *   - `params`            — JSON Schema for arguments (what the LLM passes)
 *   - `returns`           — JSON Schema for the result the executor produces (advisory; not enforced wire-side)
 *
 * Phase 1.0 ships the registry. Each subsequent Phase 1.x wires real execution
 * for one tool (Worker route for cloud tools, Rust dispatcher for desktop tools).
 *
 * Two codegen targets:
 *   - `packages/prompts/tools_v1.json` — Anthropic-shape array consumed by
 *     the Worker (`req.tools`) and by `scripts/create-agent.sh` when patching
 *     the ElevenLabs agent.
 *   - `apps/desktop/src-tauri/src/tools/generated.rs` — Rust const list of
 *     desktop tool names + their params JSON Schema (validated at dispatch).
 *
 * Run `pnpm --filter @atlas/contracts gen` to regenerate after edits here.
 */

export type ToolLocation = 'cloud' | 'desktop';

export interface ToolSpec {
  name: string;
  description: string;
  location: ToolLocation;
  confirm_required: boolean;
  params: JsonSchema;
  returns: JsonSchema;
}

// Hand-rolled minimal JSON-Schema type — only what we actually emit.
// Avoids pulling json-schema-to-ts or similar; codegen targets stay
// dependency-free.
export type JsonSchema =
  | { type: 'string'; description?: string; enum?: readonly string[]; default?: string }
  | { type: 'number'; description?: string; minimum?: number; maximum?: number; default?: number }
  | { type: 'integer'; description?: string; minimum?: number; maximum?: number; default?: number }
  | { type: 'boolean'; description?: string; default?: boolean }
  | {
      type: 'array';
      description?: string;
      items: JsonSchema;
      maxItems?: number;
      minItems?: number;
    }
  | {
      type: 'object';
      description?: string;
      properties: Record<string, JsonSchema>;
      required?: readonly string[];
      additionalProperties?: boolean;
    };

// ───────────────────────── tool definitions ─────────────────────────

const WEB_SEARCH: ToolSpec = {
  name: 'web_search',
  description:
    "Search the live web for current information. Use whenever the user asks about news, events, prices, scores, weather, or anything time-sensitive — your training cutoff is months behind. Don't use it for general knowledge the user could just chat about.",
  location: 'cloud',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query as a natural-language phrase.' },
      count: {
        type: 'integer',
        description: 'How many results to retrieve (1-10). Default 5.',
        minimum: 1,
        maximum: 10,
        default: 5,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            snippet: { type: 'string' },
          },
          required: ['title', 'url', 'snippet'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  },
};

const RENDER_ARTIFACT: ToolSpec = {
  name: 'render_artifact',
  description:
    "Show the user a visual artifact in the Atlas main window (map, chart, list, image, code, markdown, table, search_results, tutorial). Use it alongside your spoken reply — the screen carries detail your voice shouldn't. Don't read the artifact aloud, just acknowledge what's appearing.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Artifact kind. The frontend has a renderer per type.',
        enum: [
          'map',
          'chart',
          'code',
          'markdown',
          'image',
          'table',
          'search_results',
          'tutorial',
        ],
      },
      data: {
        type: 'object',
        description: 'Type-specific payload. The renderer decides the shape.',
        properties: {},
        additionalProperties: true,
      },
      narration: {
        type: 'string',
        description:
          "Optional one-sentence label of what's appearing — falls back to the renderer's default if omitted.",
      },
    },
    required: ['type', 'data'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: { rendered: { type: 'boolean' } },
    required: ['rendered'],
    additionalProperties: false,
  },
};

const LAUNCH_APP: ToolSpec = {
  name: 'launch_app',
  description:
    "Open a desktop application by its display name. Fuzzy-matches against installed apps. If the app is already running, focus it instead of launching a second instance.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'App name as the user would say it (e.g., "chrome", "obsidian", "terminal").',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      launched: { type: 'boolean' },
      app_id: { type: 'string', description: 'Resolved system app identifier, if matched.' },
    },
    required: ['launched'],
    additionalProperties: false,
  },
};

const MUSIC_CONTROL: ToolSpec = {
  name: 'music_control',
  description:
    "Control music playback. Use 'play' with a query to start something specific via Spotify (if connected). Use 'play'/'pause'/'next'/'previous'/'volume' without a query for local MPRIS players.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          "Playback verb. 'play' resumes (or starts a search if a query is given); 'volume' takes a 0-100 value.",
        enum: ['play', 'pause', 'next', 'previous', 'volume'],
      },
      query: {
        type: 'string',
        description: 'Track/artist/playlist text — required only when action="play" and the user named something.',
      },
      value: {
        type: 'number',
        description: 'Volume target 0-100 — only when action="volume".',
        minimum: 0,
        maximum: 100,
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      status: { type: 'string' },
    },
    required: ['status'],
    additionalProperties: false,
  },
};

const OPEN_PATH: ToolSpec = {
  name: 'open_path',
  description:
    "Open a file or folder with the system default app (xdg-open on Linux, `open` on macOS, `start` on Windows). Use for 'open my downloads folder', 'open the latest report', etc.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path or "~/…"-style home-relative path.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: { opened: { type: 'boolean' } },
    required: ['opened'],
    additionalProperties: false,
  },
};

const FIND_FILES: ToolSpec = {
  name: 'find_files',
  description:
    "Search for files by name within an allowed scope (home/downloads/documents). Filename-only for V1; content search lands in Phase 7.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Filename pattern (substring match, case-insensitive).' },
      scope: {
        type: 'string',
        description: 'Allowed search root. Defaults to home.',
        enum: ['home', 'downloads', 'documents'],
        default: 'home',
      },
      limit: { type: 'integer', description: 'Max results to return (1-50). Default 10.', minimum: 1, maximum: 50, default: 10 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' } },
    },
    required: ['paths'],
    additionalProperties: false,
  },
};

const SYSTEM_ACTION: ToolSpec = {
  name: 'system_action',
  description:
    "Adjust system settings (volume/brightness/DND/sleep). Use when the user asks 'turn it down', 'mute', 'do not disturb', 'lock the screen'. Always speak a one-sentence confirmation aloud BEFORE calling dnd_on or display_sleep — they're sticky.",
  location: 'desktop',
  confirm_required: true,
  params: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          "Which system control to adjust. dnd_on and display_sleep are sticky — confirm aloud first.",
        enum: [
          'volume_up',
          'volume_down',
          'mute',
          'brightness_up',
          'brightness_down',
          'dnd_on',
          'dnd_off',
          'display_sleep',
        ],
      },
      value: {
        type: 'number',
        description: 'Step size 0-100, optional. Defaults: volume ±5, brightness ±5.',
        minimum: 0,
        maximum: 100,
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: { executed: { type: 'boolean' } },
    required: ['executed'],
    additionalProperties: false,
  },
};

// ───────────────────────── registry ─────────────────────────

export const TOOL_REGISTRY: readonly ToolSpec[] = [
  WEB_SEARCH,
  RENDER_ARTIFACT,
  LAUNCH_APP,
  MUSIC_CONTROL,
  OPEN_PATH,
  FIND_FILES,
  SYSTEM_ACTION,
] as const;

export const TOOL_NAMES: readonly string[] = TOOL_REGISTRY.map((t) => t.name);

export function findTool(name: string): ToolSpec | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

export function toolsByLocation(location: ToolLocation): readonly ToolSpec[] {
  return TOOL_REGISTRY.filter((t) => t.location === location);
}

// ───────────────────────── codegen helpers ─────────────────────────

/**
 * Convert a `ToolSpec` to Anthropic's `tools[]` shape:
 * `{name, description, input_schema}`. Used both by the Worker (when forwarding
 * to Claude) and by the agent-config patcher.
 *
 * OpenAI's wire format wraps the same payload in
 * `{type: "function", function: {name, description, parameters}}` — handled at
 * the worker translator layer (apps/worker/src/claude/translate.ts).
 */
export function toolToAnthropic(spec: ToolSpec): {
  name: string;
  description: string;
  input_schema: JsonSchema;
} {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.params,
  };
}

export function allToolsAnthropic(): ReturnType<typeof toolToAnthropic>[] {
  return TOOL_REGISTRY.map(toolToAnthropic);
}
