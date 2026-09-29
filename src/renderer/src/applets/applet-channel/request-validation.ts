import { Value } from '@sinclair/typebox/value';
import type { AppletToParentRequest } from '@theweave/api';
import { AppletToParentRequest as AppletToParentRequestSchema } from '../../validationSchemas.js';

/**
 * Checks that a message from an applet iframe matches the request protocol.
 * Throws an error that names the request type and the first schema failure,
 * so the host can reply with that error instead of running no handler.
 */
export function assertValidRequest(request: unknown): asserts request is AppletToParentRequest {
  if (Value.Check(AppletToParentRequestSchema, request)) return;
  const type =
    typeof request === 'object' && request !== null && 'type' in request
      ? String((request as { type: unknown }).type)
      : undefined;
  const firstError = Value.Errors(AppletToParentRequestSchema, request).First();
  const detail = firstError ? `${firstError.path || '/'}: ${firstError.message}` : 'no detail';
  throw new Error(
    type === undefined
      ? `Invalid applet request: not an object with a type (${detail})`
      : `Invalid applet request of type '${type}' (${detail})`,
  );
}
