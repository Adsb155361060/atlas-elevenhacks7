# 0012 — Embeddings: Voyage-3, OpenAI text-embedding-3-large as fallback

- Date: 2026-05-12
- Status: Accepted

## Context

Atlas's memory + knowledge-graph + unified-search depend on embeddings of conversation turns, file content, browser history, and integration content. Public benchmarks (MTEB-style) put Voyage's voyage-3 and OpenAI's text-embedding-3-large in close competition; Voyage edges out on retrieval-with-rerank scenarios.

Embedding model changes force re-embedding the entire corpus, so this decision has a switching cost proportional to corpus size.

## Decision

- Primary embedding model: **Voyage-3** (1024-dim, hosted by Voyage AI).
- Fallback: **OpenAI text-embedding-3-large** (3072-dim).
- Re-embedding job runs when model version bumps; Phase 5.2 implements this.

## Consequences

- One additional vendor (Voyage) on the dependency list.
- Vectors stored in LanceDB with `model_version` metadata so a partial corpus doesn't poison search.
- Reranker (BGE-reranker-base, local) sits on top; embedding model can change without disrupting rerank.

## Recovery

Switching embedding models is a re-embed job (background, possibly multi-day for large corpora). Plan it during a low-traffic week.
