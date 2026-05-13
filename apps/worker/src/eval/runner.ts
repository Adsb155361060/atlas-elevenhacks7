/**
 * Dataset runner: read JSONL, run each case through the router, score, return
 * a structured summary. The CLI layer in `cli.ts` formats it for humans.
 */

import { readFile } from 'node:fs/promises';
import type { CaseOutcome, EvalSummary, TestCase } from './types.js';
import { routeOne, type RouterClient } from './router.js';

export async function loadDataset(path: string): Promise<TestCase[]> {
  const raw = await readFile(path, 'utf8');
  const cases: TestCase[] = [];
  let lineNo = 0;
  for (const rawLine of raw.split('\n')) {
    lineNo++;
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`${path}:${lineNo} — invalid JSON: ${(err as Error).message}`);
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('input' in parsed) ||
      !('expected_tool' in parsed)
    ) {
      throw new Error(
        `${path}:${lineNo} — required keys: input, expected_tool (got ${JSON.stringify(parsed)})`,
      );
    }
    const obj = parsed as Record<string, unknown>;
    cases.push({
      label: typeof obj['label'] === 'string' ? (obj['label'] as string) : `case-${lineNo}`,
      input: String(obj['input'] ?? ''),
      expected_tool:
        obj['expected_tool'] === null ? null : String(obj['expected_tool']),
      expected_args_match:
        obj['expected_args_match'] !== undefined
          ? (obj['expected_args_match'] as Record<string, unknown>)
          : undefined,
      expected_text_pattern:
        typeof obj['expected_text_pattern'] === 'string'
          ? (obj['expected_text_pattern'] as string)
          : undefined,
    });
  }
  return cases;
}

export async function runDataset(
  datasetPath: string,
  client: RouterClient,
  opts: { concurrency?: number; onCase?: (outcome: CaseOutcome) => void } = {},
): Promise<EvalSummary> {
  const cases = await loadDataset(datasetPath);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 8));
  const outcomes: CaseOutcome[] = new Array(cases.length);

  // Simple semaphore: a pool of `concurrency` workers each draining the queue.
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= cases.length) return;
      const tc = cases[idx]!;
      const result = await routeOne(client, tc);
      const outcome = scoreOutcome(tc, result);
      outcomes[idx] = outcome;
      opts.onCase?.(outcome);
    }
  });
  await Promise.all(workers);

  const passed = outcomes.filter((o) => o.pass).length;
  const errored = outcomes.filter((o) => o.result.error).length;
  const ttfbs = outcomes
    .filter((o) => !o.result.error)
    .map((o) => o.result.ttfb_ms)
    .sort((a, b) => a - b);
  const ttfb_p50_ms = ttfbs.length ? ttfbs[Math.floor(ttfbs.length * 0.5)]! : 0;
  const ttfb_p95_ms = ttfbs.length ? ttfbs[Math.min(ttfbs.length - 1, Math.floor(ttfbs.length * 0.95))]! : 0;

  return {
    dataset: datasetPath,
    total: cases.length,
    passed,
    failed: cases.length - passed - errored,
    errored,
    outcomes,
    ttfb_p50_ms,
    ttfb_p95_ms,
  };
}

// ───────────────────────── scoring ─────────────────────────

export function scoreOutcome(
  testCase: TestCase,
  result: ReturnType<typeof routeOne> extends Promise<infer R> ? R : never,
): CaseOutcome {
  if (result.error) {
    return {
      case: testCase,
      result,
      pass: false,
      fail_reason: `upstream error: ${result.error}`,
    };
  }

  // Case A: expecting no tool — call must be empty.
  if (testCase.expected_tool === null) {
    if (result.tool_calls.length !== 0) {
      return {
        case: testCase,
        result,
        pass: false,
        fail_reason: `expected no tool call, got ${result.tool_calls
          .map((t) => t.name)
          .join(',')}`,
      };
    }
    if (testCase.expected_text_pattern) {
      const re = new RegExp(testCase.expected_text_pattern, 'i');
      if (!re.test(result.text)) {
        return {
          case: testCase,
          result,
          pass: false,
          fail_reason: `text reply did not match /${testCase.expected_text_pattern}/i`,
        };
      }
    }
    return { case: testCase, result, pass: true };
  }

  // Case B: expecting a specific tool — must be the first call.
  const first = result.tool_calls[0];
  if (!first) {
    return {
      case: testCase,
      result,
      pass: false,
      fail_reason: `expected tool ${testCase.expected_tool}, got no calls`,
    };
  }
  if (first.name !== testCase.expected_tool) {
    return {
      case: testCase,
      result,
      pass: false,
      fail_reason: `expected ${testCase.expected_tool}, got ${first.name}`,
    };
  }
  if (testCase.expected_args_match) {
    const mismatch = subsetMismatch(testCase.expected_args_match, first.arguments);
    if (mismatch) {
      return {
        case: testCase,
        result,
        pass: false,
        fail_reason: `arg mismatch: ${mismatch}`,
      };
    }
  }
  return { case: testCase, result, pass: true };
}

/**
 * Deep subset match. Returns null if `expected` is a subset of `actual`, or
 * a short reason string otherwise. Strings are matched case-insensitively
 * using substring containment — the LLM may add stop-words that don't
 * change meaning ("weather lagos" vs "weather in lagos").
 */
function subsetMismatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): string | null {
  for (const [k, ev] of Object.entries(expected)) {
    const av = actual[k];
    if (av === undefined) return `missing key "${k}"`;
    if (typeof ev === 'string') {
      if (typeof av !== 'string' || !av.toLowerCase().includes(ev.toLowerCase())) {
        return `key "${k}": "${av}" does not contain "${ev}"`;
      }
    } else if (typeof ev === 'object' && ev !== null && !Array.isArray(ev)) {
      if (typeof av !== 'object' || av === null) return `key "${k}": expected object`;
      const inner = subsetMismatch(
        ev as Record<string, unknown>,
        av as Record<string, unknown>,
      );
      if (inner) return `${k}.${inner}`;
    } else {
      if (ev !== av) return `key "${k}": expected ${JSON.stringify(ev)}, got ${JSON.stringify(av)}`;
    }
  }
  return null;
}
