/**
 * Atlas Worker entry point.
 * Hono app wired to /healthz and /v1/chat/completions.
 */

import { Hono } from 'hono';
import { parseEnv, type Env } from './env.js';
import { healthz } from './routes/healthz.js';
import { chatCompletions } from './routes/chatCompletions.js';

const app = new Hono<{ Bindings: Env }>();

// Validate env on every request at the boundary.
// Cheap (zod parse on a small object); fail loudly if a key is missing.
app.use('*', async (c, next) => {
  try {
    c.env = parseEnv(c.env) as Env;
  } catch (err) {
    return c.json(
      {
        error: {
          message: 'worker misconfigured: env validation failed',
          type: 'internal_error',
          code: 'env_invalid',
          details: err instanceof Error ? err.message : String(err),
        },
      },
      500,
    );
  }
  await next();
});

app.route('/healthz', healthz);
app.route('/v1/chat/completions', chatCompletions);

app.notFound((c) =>
  c.json(
    {
      error: {
        message: `no route for ${c.req.method} ${c.req.path}`,
        type: 'invalid_request_error',
        code: 'not_found',
      },
    },
    404,
  ),
);

app.onError((err, c) => {
  console.error('atlas-worker unhandled error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: c.req.path,
  });
  return c.json(
    {
      error: {
        message: 'internal server error',
        type: 'internal_error',
        code: 'unhandled',
      },
    },
    500,
  );
});

export default app;
