/**
 * Mirrors MAX_DATAGRAM_BYTES in the renderer's protocol module. The two
 * processes share no code, and main needs the cap before it forwards anything.
 */
export const MAX_DATAGRAM_BYTES = 1200;
