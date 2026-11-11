import { SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

it('unknown route is a 404 json error', async () => {
  const res = await SELF.fetch('https://w/nope');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found', message: expect.any(String) });
});

it('old /feedback route is gone', async () => {
  const res = await SELF.fetch('https://w/feedback', { method: 'POST' });
  expect(res.status).toBe(404);
});
