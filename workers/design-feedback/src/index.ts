import type { Env } from './env';
import { route, type Route } from './router';

const routes: Route[] = [];

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return route(req, routes, env, ctx);
  },
} satisfies ExportedHandler<Env>;
