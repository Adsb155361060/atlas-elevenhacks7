# 0007 — Package manager: pnpm

- Date: 2026-05-12
- Status: Accepted

## Context

Monorepo (ADR 0009) with workspaces. Three viable JS package managers: npm (deterministic but slow), yarn classic / yarn berry (mature but bifurcated ecosystem), pnpm (fast, disk-efficient via content-addressable store, first-class workspace support).

## Decision

Use **pnpm 9** as the JavaScript/TypeScript package manager. Workspace declared in `pnpm-workspace.yaml`.

## Consequences

- One install populates apps/* and packages/* deterministically.
- Disk usage stays low across worktrees.
- Some tools (e.g., older Vercel CI configs) assume npm — document workarounds in runbooks.

## Recovery

Switching package managers is a one-day chore. Lockfile regenerates; CI configs swap. Low risk.
