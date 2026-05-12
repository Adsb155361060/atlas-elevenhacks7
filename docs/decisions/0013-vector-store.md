# 0013 — Vector store: LanceDB (local)

- Date: 2026-05-12
- Status: Accepted

## Context

The privacy-first stance (build plan §14) makes local-first the default. Vector store options: LanceDB (Rust-native, on-disk Arrow, embedded), SQLite-vec (extension), DuckDB-vss, Chroma (server), Pinecone / Turbopuffer (cloud), Qdrant (embedded or server).

LanceDB matches Tauri's Rust core, runs in-process, no extra daemon, has good IVF/HNSW indexes, and supports filters and metadata queries natively.

## Decision

Use **LanceDB** for the local vector index. Stored at `~/.local/share/atlas/lance/` (per-platform XDG paths). Encrypted at rest in Phase 14.2.

## Consequences

- Vectors never leave the user's device by default — strong privacy claim.
- Multi-device sync (Phase 14 → V3) requires explicit work; not free like a cloud vector DB.
- Backup / restore goes through the data-export flow (Phase 14.5).

## Recovery

If LanceDB hits a wall (corpus size, query latency at scale), swap to Qdrant embedded — similar embedded story. Migration is a one-time job: re-embed and re-import.
