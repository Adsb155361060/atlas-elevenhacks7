# 0008 — License: MIT

- Date: 2026-05-12
- Status: Accepted

## Context

License affects adoption velocity, contributor base, integration freedom for users (especially enterprise), and commercial path. Common choices: MIT (permissive, max adoption), Apache 2.0 (permissive + explicit patent grant), GPLv3 (copyleft; restricts commercial fork), AGPLv3 (copyleft + closes the SaaS loophole), source-available (Elastic / SSPL / BSL).

Atlas wants maximum adoption + hackability (the differentiation moat against closed-garden incumbents). Source-available licenses kill the hackability angle. GPL deters enterprise.

## Decision

License Atlas under **MIT**. Every contributor agrees by submitting under the same terms.

## Consequences

- Anyone can fork, modify, ship commercially.
- Enterprise legal review is easy.
- We may need a CLA later if the project takes contributors; defer until needed.
- A commercial fork of Atlas could exist. We accept this because the moat is in the integrated product (IVC + memory + integrations + UX), not the source.

## Recovery

License can be tightened (e.g., MIT → BSL with grace period) before contributions accumulate; harder afterward. We accept that MIT is functionally permanent.
