import type {
  FeedbackErrorCode,
  FeedbackErrorResponse,
} from '../../../shared/utils/src/feedback/index.ts';
import type { Env } from './env';

export type Handler = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

export interface Route {
  method: string;
  path: RegExp;
  handler: Handler;
}

// No CORS headers: the only caller is the Moss Electron main process, never a browser page.
const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function jsonError(status: number, error: FeedbackErrorCode, message: string): Response {
  const body: FeedbackErrorResponse = { error, message };
  return jsonOk(body, status);
}

/** Dispatches to the first route whose method and pathname match; anything else is a 404. */
export function route(
  req: Request,
  routes: Route[],
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(req.url);
  const match = routes.find((r) => r.method === req.method && r.path.test(pathname));
  if (!match) {
    return Promise.resolve(jsonError(404, 'not_found', `No route for ${req.method} ${pathname}`));
  }
  return match.handler(req, env, ctx);
}
