/**
 * Codegen: write `packages/prompts/tools_v1.json` from the tool registry.
 *
 * Output shape: Anthropic-style array of `{name, description, input_schema}`
 * — consumed by the Worker (for forwarding to Claude) and by the
 * `scripts/create-agent.sh` flow when patching the ElevenLabs agent config.
 *
 * Run: `pnpm --filter @atlas/contracts gen` (or `pnpm gen` from the package).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allToolsAnthropic, TOOL_REGISTRY } from '../src/tools/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const outPath = resolve(repoRoot, 'packages', 'prompts', 'tools_v1.json');

const payload = {
  $generated_by: 'packages/contracts/scripts/gen.ts',
  $do_not_edit: 'Edit packages/contracts/src/tools/index.ts and rerun pnpm gen.',
  $version: 'v1',
  count: TOOL_REGISTRY.length,
  tools: allToolsAnthropic(),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

console.log(`✓ wrote ${TOOL_REGISTRY.length} tools to ${outPath.replace(repoRoot + '/', '')}`);
