# Runbook — Rotate API keys

Stub. Filled before first key has lived for 90 days.

## Keys to rotate periodically

- ANTHROPIC_API_KEY (every 90 days)
- ELEVENLABS_API_KEY (every 90 days)
- GEMINI_API_KEY (every 90 days)
- VOYAGE_API_KEY (every 90 days)
- BRAVE_SEARCH_API_KEY (annually)
- ALLOWED_AGENT_TOKENS (every 30 days; supports comma-separated for zero-downtime rotation)
- Picovoice access key (annually or per Picovoice policy)
- Cloudflare API token (every 90 days)

## Procedure (target)

1. Generate new key in vendor dashboard.
2. Add to `wrangler secret put` alongside the old (rotation-friendly env names).
3. Deploy.
4. Verify health.
5. Remove old key from vendor.
6. Audit-log the rotation in `~/.local/share/atlas/logs/`.
