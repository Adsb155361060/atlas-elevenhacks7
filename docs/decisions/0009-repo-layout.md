# 0009 — Repo layout: monorepo with pnpm workspaces

- Date: 2026-05-12
- Status: Accepted

## Context

Solo dev shipping a desktop app + a Cloudflare Worker + shared TypeScript types + versioned prompts + future marketing site. Options: monorepo (one git repo, multiple packages) or polyrepo (separate repos per app).

Shared types between Worker and Desktop are load-bearing (tool schemas). Coordinated commits across Worker + Desktop are common (Phase 1 onward). Solo dev means the coordination overhead of polyrepo is pure cost.

## Decision

Use a **monorepo** at `atlas/` with pnpm workspaces. `apps/*` for deployables, `packages/*` for shared libraries (contracts, prompts, sdk).

## Consequences

- One install, one CI config (with per-app workflows), atomic commits across app boundaries.
- Build times grow with the repo; mitigate with Turbo or Nx later if needed.
- Releases are per-app (Worker via wrangler, Desktop via Tauri Updater); monorepo doesn't bundle them.

## Recovery

Splitting a monorepo into polyrepos with preserved history is mechanical (`git subtree split`). Low cost if we ever need it (team size ≥ 5+, divergent CI needs).
