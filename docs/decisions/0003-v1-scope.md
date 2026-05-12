# 0003 — V1 scope: build plan Phases 0–5 in full

- Date: 2026-05-12
- Status: Accepted

## Context

The build plan structures features into 18 phases. Phases 0–5 cover: foundation (voice loop), voice command basics, iterative content generation, vision + camera, computer control depth, and memory. These together produce a recordable hero demo and the differentiation moat (IVC voice + persistent memory + iterative content).

There is no external deadline (project memory `project_atlas_scope.md`); the months-long timeline means we ship every module of Phases 0–5 in full, including modules previously marked as cut-line.

## Decision

V1 scope = **all modules of build plan Phases 0–5**, including auto-summarization (5.4), interest profile (5.5), personalized briefings (5.6), user IVC (5.8), recipes (4.6), macOS AXUI (4.3), and Windows UIA (4.4). Six-week target per §28.1 of dev plan.

## Consequences

- V1 ships with feature breadth incumbents cannot match in 6 weeks.
- Cross-OS work (4.3, 4.4) requires Mac + Windows test machines (§30 open Q4).
- Cost at launch is real ($99/mo ElevenLabs + ~$200 dev API spend); accept it.

## Recovery

If a deadline materializes mid-build (funding, demo day), switch to §25 contingency plan in `jarvis_dev_plan.md`. Every cut module is recoverable in the next phase per §25.4.
