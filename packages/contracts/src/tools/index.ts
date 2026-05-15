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

const GENERATE_MUSIC: ToolSpec = {
  name: 'generate_music',
  description:
    "Generate a short original music track via ElevenLabs Music. Use when the user asks for music ('make me a lo-fi loop', 'something cinematic'). After the tool returns, immediately call render_artifact with type=audio so the user can hear it. Don't try to describe the music in words — let the user listen.",
  location: 'cloud',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'Natural-language style + mood description (e.g., "warm lo-fi hip-hop loop with vinyl crackle").',
      },
      duration_ms: {
        type: 'integer',
        description: 'Track length in milliseconds. 5000-180000 (5s-3min). Default 30000.',
        minimum: 5000,
        maximum: 180_000,
        default: 30_000,
      },
      instrumental: {
        type: 'boolean',
        description: 'When true, ElevenLabs is forbidden from adding vocals. Default false.',
        default: false,
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      audio_data_uri: { type: 'string', description: 'data:audio/mpeg;base64,… playable in <audio>.' },
      duration_ms: { type: 'integer' },
      prompt: { type: 'string' },
    },
    required: ['audio_data_uri', 'duration_ms', 'prompt'],
    additionalProperties: false,
  },
};

const TAKE_NOTE: ToolSpec = {
  name: 'take_note',
  description:
    "Save a personal note locally for the user. Use when they say 'make a note', 'remind me later that', 'save this'. Notes persist across sessions and the user can recall them with list_notes. Body is required; title + tags optional.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      body: { type: 'string', description: 'The note content as spoken-friendly prose.' },
      title: { type: 'string', description: 'Optional short label.' },
      tags: {
        type: 'array',
        description: 'Optional flat tag list for retrieval.',
        items: { type: 'string', description: 'Single tag word.' },
      },
    },
    required: ['body'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      saved: { type: 'boolean' },
      id: { type: 'string' },
    },
    required: ['saved'],
    additionalProperties: false,
  },
};

const LIST_NOTES: ToolSpec = {
  name: 'list_notes',
  description:
    "Recall saved notes. Use when the user asks 'what notes do I have', 'find my note about X', 'show my recent notes'. Returns newest-first. Filter by substring (query) or tag.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Substring filter over title + body.' },
      tag: { type: 'string', description: 'Exact tag match (case-insensitive).' },
      limit: { type: 'integer', description: 'Max results 1-50. Default 10.', minimum: 1, maximum: 50, default: 10 },
    },
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      count: { type: 'integer' },
      notes: { type: 'array', items: { type: 'object', description: 'Note', properties: {}, additionalProperties: true } },
    },
    required: ['count', 'notes'],
    additionalProperties: false,
  },
};

const READ_CLIPBOARD: ToolSpec = {
  name: 'read_clipboard',
  description:
    "Read the user's system clipboard. Use whenever the user says 'what did I just copy', 'translate what's on my clipboard', 'check my clipboard'. Returns up to 2000 chars; longer content is marked truncated.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      length: { type: 'integer' },
      truncated: { type: 'boolean' },
    },
    required: ['text', 'length', 'truncated'],
    additionalProperties: false,
  },
};

const WRITE_CLIPBOARD: ToolSpec = {
  name: 'write_clipboard',
  description:
    "Push text to the user's system clipboard. Use after you've generated code, an address, a phone number, or anything else they'd want to paste elsewhere. Don't read it aloud — just tell them it's copied.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to place on the clipboard.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      written: { type: 'boolean' },
      length: { type: 'integer' },
    },
    required: ['written'],
    additionalProperties: false,
  },
};

const CALENDAR_TODAY: ToolSpec = {
  name: 'calendar_today',
  description:
    "Read the user's calendar events for today (or a given date) from macOS Calendar.app. Use whenever they say 'what's on my schedule', 'what meetings do I have', 'am I free this afternoon', 'do I have anything at 3'. After the tool returns, summarise in one or two sentences ('two meetings — coffee with Sara at 10, design review at 2') AND call render_artifact type=table with the full list so they can glance at it.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: "Optional ISO date YYYY-MM-DD. Defaults to today in the user's local time.",
      },
    },
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      count: { type: 'integer' },
      events: {
        type: 'array',
        items: { type: 'object', description: 'Calendar event', properties: {}, additionalProperties: true },
      },
    },
    required: ['count', 'events'],
    additionalProperties: false,
  },
};

const SET_TIMER: ToolSpec = {
  name: 'set_timer',
  description:
    "Set a one-shot countdown timer. Use when the user says 'set a 10-minute timer', 'remind me in an hour', 'wake me up in 25 minutes'. Range 5s-4h. The frontend shows a live countdown card; an OS notification + sound fires at zero.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      seconds: {
        type: 'integer',
        description: 'Countdown length in seconds. 5-14400 (5s to 4h).',
        minimum: 5,
        maximum: 14_400,
      },
      label: {
        type: 'string',
        description: "What to call the timer when it fires. Defaults to 'Timer done'.",
      },
    },
    required: ['seconds'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      scheduled: { type: 'boolean' },
      seconds: { type: 'integer' },
    },
    required: ['scheduled'],
    additionalProperties: false,
  },
};

const VISION_QA: ToolSpec = {
  name: 'vision_qa',
  description:
    "Look at the user's screen and answer a question about what's on it. Use whenever the user says 'what's on my screen', 'what does this error mean', 'read this for me', 'what's that icon', etc. The desktop captures a screenshot, the worker forwards it to Claude vision, and you get one or two sentences back. Then speak the answer plainly — don't add 'I see' or 'it looks like'.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          "What you want answered about the screen. Be specific — 'what does the red error say' beats 'what's wrong'.",
      },
      source: {
        type: 'string',
        description: "Where to grab the image from. Default 'screen'; 'camera' lands in a later phase.",
        enum: ['screen', 'camera'],
        default: 'screen',
      },
    },
    required: ['question'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
    },
    required: ['answer'],
    additionalProperties: false,
  },
};

const GENERATE_IMAGE: ToolSpec = {
  name: 'generate_image',
  description:
    "Generate an image from a text prompt via Gemini Imagen 3. Use whenever the user asks you to draw, generate, paint, or imagine something visual. After the tool returns, immediately call render_artifact with type=image so the user can see it.",
  location: 'cloud',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed scene description. More vivid = better output ("a watercolour of a cat astronaut on Mars at sunset").',
      },
      aspect_ratio: {
        type: 'string',
        description: 'Output frame shape. Default 1:1 (square).',
        enum: ['1:1', '16:9', '9:16', '3:4', '4:3'],
        default: '1:1',
      },
      count: {
        type: 'integer',
        description: 'How many images to generate (1-4). Default 1.',
        minimum: 1,
        maximum: 4,
        default: 1,
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      images: {
        type: 'array',
        items: { type: 'string', description: 'data:image/png;base64,…' },
      },
      prompt: { type: 'string' },
    },
    required: ['images', 'prompt'],
    additionalProperties: false,
  },
};

const RENDER_ARTIFACT: ToolSpec = {
  name: 'render_artifact',
  description:
    "Show the user a visual artifact in the Atlas main window (map, chart, list, image, code, markdown, table, search_results, tutorial). Use it alongside your spoken reply — the screen carries detail your voice shouldn't. Don't read the artifact aloud, just acknowledge what's appearing.\n\nITERATIVE REFINEMENT: when the user refines an existing artifact ('zoom in', 'now in red', 'add the tube stations', 'sort by date'), call render_artifact AGAIN with the SAME `id` you used the first time and the FULL new data. The desktop versions the artifact in place — the user sees a smooth update, not a fresh render. Pass a new (or omitted) `id` only for a genuinely new artifact.",
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
          'audio',
          'table',
          'search_results',
          'tutorial',
        ],
      },
      data: {
        type: 'object',
        description: 'Type-specific payload — the full state of the artifact. The renderer decides the shape.',
        properties: {},
        additionalProperties: true,
      },
      narration: {
        type: 'string',
        description:
          "Optional one-sentence label of what's appearing — falls back to the renderer's default if omitted.",
      },
      id: {
        type: 'string',
        description:
          "Stable id for cross-turn iteration. Pick a short, descriptive slug the FIRST time you show an artifact (e.g. 'london-map', 'covid-rates-chart'), then reuse the SAME id on every follow-up that refines it. Omit only for a brand-new, unrelated artifact.",
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

const BATTERY_STATUS: ToolSpec = {
  name: 'battery_status',
  description:
    "Report the machine's battery charge level and whether it's plugged in. Use when the user asks 'what's my battery', 'am I charging', 'how much battery do I have left'. Desktops with no battery return present:false — say so plainly.",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      present: { type: 'boolean', description: 'False on desktops with no battery.' },
      percent: { type: 'number', description: 'Charge 0-100, or null if unreadable.' },
      charging: { type: 'boolean', description: 'True when on AC power / charging.' },
    },
    required: ['present', 'charging'],
    additionalProperties: false,
  },
};

const LOCK_SCREEN: ToolSpec = {
  name: 'lock_screen',
  description:
    "Lock the workstation immediately. Use when the user says 'lock my screen', 'lock the computer', 'I'm stepping away'. Speak a one-sentence confirmation aloud BEFORE calling this — it's disruptive and immediate.",
  location: 'desktop',
  confirm_required: true,
  params: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: { locked: { type: 'boolean' } },
    required: ['locked'],
    additionalProperties: false,
  },
};

const SCREENSHOT: ToolSpec = {
  name: 'screenshot',
  description:
    "Capture the whole screen to a PNG file saved in the user's Pictures folder. Use when the user says 'take a screenshot', 'capture my screen', 'save a picture of this'. Returns the saved file path — read it back so the user knows where it landed. (To answer a question ABOUT the screen instead, use vision_qa.)",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      saved: { type: 'boolean' },
      path: { type: 'string', description: 'Absolute path of the saved PNG.' },
    },
    required: ['saved'],
    additionalProperties: false,
  },
};

const COMPOSE_EMAIL: ToolSpec = {
  name: 'compose_email',
  description:
    "Open a prefilled email draft in the user's default mail client (Outlook / Mail.app / Gmail web). Use when the user dictates an email: 'email Boss, subject: lunch, tell them I'll be late'. Always speak a one-sentence read-back of the draft before calling so they can correct it ('Draft to boss@: I'll be late to lunch — open it now?'). The user still presses Send themselves in the mail window. For fully hands-free sending, use send_email instead (requires one-time Gmail-API setup).",
  location: 'desktop',
  confirm_required: false,
  params: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address. Required.' },
      subject: { type: 'string', description: 'Subject line. Recommended.' },
      body: { type: 'string', description: 'Email body, plain text. Multi-line ok.' },
      cc: { type: 'string', description: 'Optional CC, comma-separated.' },
      bcc: { type: 'string', description: 'Optional BCC, comma-separated.' },
    },
    required: ['to'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: { composed: { type: 'boolean' } },
    required: ['composed'],
    additionalProperties: false,
  },
};

const SEND_EMAIL: ToolSpec = {
  name: 'send_email',
  description:
    "Send an email hands-free via the Gmail API. The user does NOT touch the keyboard — the message goes straight from voice to inbox. Always confirm aloud BEFORE calling ('Sending to a@b.com, subject \"Late\", body \"…\" — okay?'), and only proceed on a clear yes. If the user just dictates without explicit send intent, use compose_email instead. Requires a one-time OAuth setup; if it returns a configuration error, gracefully fall back to compose_email.",
  location: 'desktop',
  confirm_required: true,
  params: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address. Required.' },
      subject: { type: 'string', description: 'Subject line.' },
      body: { type: 'string', description: 'Email body, plain text.' },
      cc: { type: 'string', description: 'Optional CC, comma-separated.' },
      bcc: { type: 'string', description: 'Optional BCC, comma-separated.' },
    },
    required: ['to'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      sent: { type: 'boolean' },
      message_id: { type: 'string' },
      thread_id: { type: 'string' },
    },
    required: ['sent'],
    additionalProperties: false,
  },
};

const TYPE_TEXT: ToolSpec = {
  name: 'type_text',
  description:
    "Type text into whatever the user has keyboard focus on (an email reply, a chat box, a search bar, a text field). Phase 4 voice-driven app operation — the user puts focus where they want, then says what to type. Always read the text back in one sentence and CONFIRM aloud before calling; typing into the wrong window is hard to undo. Use this for composing or dictating, NOT for triggering app commands (use press_key for shortcuts like cmd+s).",
  location: 'desktop',
  confirm_required: true,
  params: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to type. Newlines are typed as Enter presses.' },
      press_enter: {
        type: 'boolean',
        description: "Press Enter after typing — handy for 'type and send this message'. Defaults to false.",
      },
    },
    required: ['text'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      typed: { type: 'boolean' },
      chars: { type: 'integer' },
    },
    required: ['typed'],
    additionalProperties: false,
  },
};

const PRESS_KEY: ToolSpec = {
  name: 'press_key',
  description:
    "Send a keyboard shortcut to whatever has focus. Phase 4 voice-driven app operation: 'save this' → press_key cmd+s, 'close this tab' → cmd+w, 'switch apps' → alt+tab, 'submit the form' → enter. Notation: 'mod+mod+key' (e.g. 'cmd+s', 'ctrl+shift+t', 'alt+f4', 'enter', 'f5'). 'cmd' means the primary accelerator — ⌘ on macOS, Ctrl on Windows/Linux. Confirm aloud before destructive shortcuts (cmd+q quit, alt+f4 close, cmd+w close).",
  location: 'desktop',
  confirm_required: true,
  params: {
    type: 'object',
    properties: {
      keys: {
        type: 'string',
        description:
          "Shortcut in 'mod+mod+key' notation. Modifiers: cmd, ctrl, alt, shift, super. Keys: a letter/digit, or named (enter, tab, space, escape, backspace, delete, home, end, pageup, pagedown, up, down, left, right, insert, f1-f24).",
      },
    },
    required: ['keys'],
    additionalProperties: false,
  },
  returns: {
    type: 'object',
    properties: {
      pressed: { type: 'boolean' },
      keys: { type: 'string' },
    },
    required: ['pressed'],
    additionalProperties: false,
  },
};

// ───────────────────────── registry ─────────────────────────

export const TOOL_REGISTRY: readonly ToolSpec[] = [
  WEB_SEARCH,
  GENERATE_MUSIC,
  GENERATE_IMAGE,
  VISION_QA,
  RENDER_ARTIFACT,
  LAUNCH_APP,
  MUSIC_CONTROL,
  OPEN_PATH,
  FIND_FILES,
  SYSTEM_ACTION,
  TAKE_NOTE,
  LIST_NOTES,
  READ_CLIPBOARD,
  WRITE_CLIPBOARD,
  SET_TIMER,
  CALENDAR_TODAY,
  BATTERY_STATUS,
  LOCK_SCREEN,
  SCREENSHOT,
  COMPOSE_EMAIL,
  SEND_EMAIL,
  TYPE_TEXT,
  PRESS_KEY,
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
