import { Hono } from 'hono';
import type { Env } from '../env.js';

export const healthz = new Hono<{ Bindings: Env }>();

healthz.get('/', (c) => {
  const env = c.env;
  return c.json({
    ok: true,
    service: 'atlas-worker',
    version: env.WORKER_VERSION,
    timestamp: new Date().toISOString(),
  });
});
