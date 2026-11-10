import type { Env } from './env';
import { route, type Route } from './router';
import { createIssueRoute } from './routes/createIssue';
import { syncRoute } from './routes/sync';
import { webhookRoute } from './routes/webhook';

const routes: Route[] = [createIssueRoute(), syncRoute(), webhookRoute()];

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return route(req, routes, env, ctx);
  },
} satisfies ExportedHandler<Env>;
