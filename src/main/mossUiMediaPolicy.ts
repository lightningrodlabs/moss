// Media requests from Moss's own UI, as opposed to a Tool.
//
// Moss's renderer asks for the microphone only when the user presses a
// Moss control that needs it (for example foyer dictation, which also
// requires the Transcription switch). That press is the user's consent,
// so such a request needs no dialog. Tool iframes live on their own
// origins (applet://, cross-group://) and never match here.

export interface MossUiMediaRequest {
  /** True when the request comes from the main window's webContents. */
  fromMainWindow: boolean;
  /** The URL of the frame that asked. */
  requestingUrl: string;
  /** The URL the main window has loaded. */
  mainWindowUrl: string;
  mediaTypes: ReadonlyArray<string> | undefined;
}

/** True for a microphone-only request from the main window's own renderer origin. */
export function isMossUiMicrophoneRequest(req: MossUiMediaRequest): boolean {
  if (!req.fromMainWindow) return false;
  if (!req.mediaTypes || req.mediaTypes.length !== 1 || req.mediaTypes[0] !== 'audio') {
    return false;
  }
  const requesting = originOf(req.requestingUrl);
  return requesting !== null && requesting === originOf(req.mainWindowUrl);
}

// `URL.origin` is "null" for custom schemes such as moss://, so the
// origin is built from protocol and host directly.
function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
