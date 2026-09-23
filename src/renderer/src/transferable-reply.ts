/**
 * A handler result that must be posted with a transfer list. Only
 * `request-audio-sources` produces one; every other reply stays a plain value.
 */
export class TransferableReply<T = unknown> {
  constructor(
    public readonly result: T,
    public readonly transfer: Transferable[],
  ) {}
}
