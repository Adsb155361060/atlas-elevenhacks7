/**
 * Eval harness types. The eval harness is a router-level test: it sends each
 * dataset case to the deployed Worker `/v1/chat/completions` with the full
 * tool registry, parses the SSE response, and checks which tool Claude
 * picked + a subset match on the arguments.
 *
 * Tool *execution* correctness is unit-testable inside each tool's
 * implementation (see `apps/worker/src/tools/*.test.ts` and the Rust side's
 * per-tool tests). The harness only validates routing — does the model
 * choose the right tool for a given utterance?
 */

import type { JsonSchema } from '@atlas/contracts/tools';

export interface TestCase {
  /** Human-readable label shown in test output. */
  label: string;
  /** The user utterance (single-turn). */
  input: string;
  /** Tool name expected to be selected, or `null` for "no tool — pure text reply". */
  expected_tool: string | null;
  /**
   * Subset match against the tool call's argument object. Each key must be
   * present in the call and equal (deep equality for nested objects, exact
   * for strings/numbers/booleans). Extra keys in the call are ignored.
   *
   * Example: `{ "query": "weather lagos" }` matches a call with
   * `{ "query": "weather lagos", "count": 5 }`.
   */
  expected_args_match?: Record<string, unknown>;
  /**
   * Optional regex (string form) the assistant text reply must match. Used
   * for general-Q&A cases where we want to verify a tone / format.
   */
  expected_text_pattern?: string;
}

export interface ToolCallSeen {
  name: string;
  arguments: Record<string, unknown>;
}

export interface RouterResult {
  text: string;
  tool_calls: ToolCallSeen[];
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
  /** Time in ms from request start to first SSE chunk received. */
  ttfb_ms: number;
  /** Total elapsed time for the full SSE stream. */
  total_ms: number;
  /** Raw error message if the request failed. */
  error?: string;
}

export interface CaseOutcome {
  case: TestCase;
  result: RouterResult;
  /** True ⇔ tool matches expected AND args subset matches AND (if set) text pattern matches. */
  pass: boolean;
  /** Why it failed, when `pass=false`. */
  fail_reason?: string;
}

export interface EvalSummary {
  dataset: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  outcomes: CaseOutcome[];
  /** Mean ttfb across non-errored cases. */
  ttfb_p50_ms: number;
  ttfb_p95_ms: number;
}

export type { JsonSchema };
