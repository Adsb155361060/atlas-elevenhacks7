#!/usr/bin/env node
/**
 * Eval CLI. Reads `.env.local` for the deployed Worker URL + bearer token,
 * runs one or more datasets, prints a results table.
 *
 * Usage:
 *   pnpm --filter @atlas/worker eval
 *       (runs all datasets in tools/eval/datasets/*.jsonl)
 *   pnpm --filter @atlas/worker eval router-baseline
 *       (runs only router-baseline.jsonl)
 *   pnpm --filter @atlas/worker eval --model claude-opus-4-7
 *       (override routing model; default is haiku-4.5 because routing is
 *        a closed-form decision and haiku is 10× cheaper and faster)
 *
 * Exit code: number of failed cases (cap 255), 0 on full pass.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDataset } from './runner.js';
import type { CaseOutcome, EvalSummary } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const datasetsDir = resolve(repoRoot, 'tools', 'eval', 'datasets');

// ───────────────────────── arg parsing ─────────────────────────

const argv = process.argv.slice(2);
let modelOverride: string | undefined;
const datasetFilters: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === '--model') {
    modelOverride = argv[++i];
  } else if (a === '--help' || a === '-h') {
    console.log('Usage: pnpm --filter @atlas/worker eval [<dataset-stem>…] [--model <model>]');
    process.exit(0);
  } else if (a.startsWith('--')) {
    console.error(`unknown flag: ${a}`);
    process.exit(2);
  } else {
    datasetFilters.push(a);
  }
}

// ───────────────────────── env ─────────────────────────

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    out[k] = v;
  }
  return out;
}

const env = { ...readEnvFile(resolve(repoRoot, '.env.local')), ...process.env };
const workerUrl = env['ATLAS_WORKER_URL'];
const tokenRaw = env['ALLOWED_AGENT_TOKENS'] ?? env['ATLAS_AGENT_TOKEN'];

if (!workerUrl || workerUrl.includes('example.workers.dev')) {
  console.error('error: ATLAS_WORKER_URL not set in .env.local (or still placeholder)');
  process.exit(2);
}
if (!tokenRaw || tokenRaw === 'replace-with-strong-random') {
  console.error('error: ALLOWED_AGENT_TOKENS / ATLAS_AGENT_TOKEN not set in .env.local');
  process.exit(2);
}
// `ALLOWED_AGENT_TOKENS` is comma-separated; use the first.
const token = tokenRaw.split(',')[0]!.trim();

// ───────────────────────── dataset discovery ─────────────────────────

function listDatasets(): string[] {
  if (!existsSync(datasetsDir)) {
    console.error(`error: dataset dir not found: ${datasetsDir}`);
    process.exit(2);
  }
  return readdirSync(datasetsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => resolve(datasetsDir, f))
    .sort();
}

let datasets = listDatasets();
if (datasetFilters.length > 0) {
  datasets = datasets.filter((p) => {
    const stem = basename(p, '.jsonl');
    return datasetFilters.some((f) => stem === f || stem.includes(f));
  });
  if (datasets.length === 0) {
    console.error(`error: no datasets matched filters: ${datasetFilters.join(', ')}`);
    process.exit(2);
  }
}

console.log(`eval: worker=${workerUrl}`);
console.log(`eval: model=${modelOverride ?? 'claude-haiku-4-5-20251001 (default)'}`);
console.log(`eval: datasets=${datasets.length}`);

// ───────────────────────── run ─────────────────────────

const summaries: EvalSummary[] = [];
let totalCases = 0;
let totalFailed = 0;

for (const dataset of datasets) {
  const label = basename(dataset, '.jsonl');
  console.log(`\n━━━ ${label} ━━━`);
  const summary = await runDataset(
    dataset,
    {
      workerUrl,
      token,
      ...(modelOverride !== undefined ? { model: modelOverride } : {}),
    },
    {
      concurrency: 3,
      onCase: (oc) => printOutcome(oc),
    },
  );
  summaries.push(summary);
  totalCases += summary.total;
  totalFailed += summary.failed + summary.errored;
  printSummary(summary);
}

if (summaries.length > 1) {
  console.log('\n━━━ overall ━━━');
  console.log(
    `${totalCases - totalFailed}/${totalCases} passed across ${summaries.length} datasets`,
  );
}

process.exit(Math.min(255, totalFailed));

// ───────────────────────── formatting ─────────────────────────

function printOutcome(oc: CaseOutcome): void {
  const mark = oc.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const timing = `${Math.round(oc.result.ttfb_ms)}ms`;
  const seenTool = oc.result.tool_calls[0]?.name ?? 'no tool';
  const label = oc.case.label.padEnd(36);
  const expected = oc.case.expected_tool ?? 'no tool';
  console.log(
    `  ${mark}  ${label}  ${timing.padStart(7)}  ${expected.padEnd(18)} → ${seenTool}`,
  );
  if (!oc.pass) {
    console.log(`        \x1b[31m${oc.fail_reason}\x1b[0m`);
  }
}

function printSummary(s: EvalSummary): void {
  console.log(
    `  → ${s.passed}/${s.total} passed${s.failed ? `, ${s.failed} failed` : ''}${
      s.errored ? `, ${s.errored} errored` : ''
    }   ttfb p50=${Math.round(s.ttfb_p50_ms)}ms p95=${Math.round(s.ttfb_p95_ms)}ms`,
  );
}
