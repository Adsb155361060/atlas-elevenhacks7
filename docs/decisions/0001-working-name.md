# 0001 — Working name: Atlas

- Date: 2026-05-12
- Status: Accepted (dev-time identifier only; public-launch rename is a separate ADR)

## Context

"JARVIS" — the placeholder in the build plan — is Disney/Marvel-trademarked and cannot ship commercially. We need a stable dev-time identifier so file names, agents, repos, and runbooks stay consistent without rework. A public-launch name will be chosen later (trademark cleared, marketing-tested).

Build plan §0 suggested alternatives: Atlas, Prometheus, Hermes, Oracle, Pax, Nova, Ada, Argus, Lumen, Vani.

## Decision

Use **Atlas** as the working name throughout development, code, documentation, and dev-time UX. Audit for trademark conflicts and validate a public-launch name before V3 public marketing (see §29.5 of dev plan).

## Consequences

- All code, repos, agent IDs, env vars, docs use "Atlas" / "atlas".
- The IVC voice, system tray, system prompts say "Atlas".
- We commit to a rename pass before any public marketing; estimate one focused week.
- Domain `atlas.so`, `useatlas.app`, etc. are likely taken — do not buy until the public-name decision is made.

## Recovery

If Atlas is rejected (trademark conflict surfaces, or marketing finds something stronger), do a global find/replace across code (single-word, low-blast-radius), regenerate IVC samples that reference the name aloud, and bump every prompt version. Cost: ~3 dev-days. We accept this cost as the price of starting now.
