/**
 * Whether a Tool may ask Moss to load the speech model before it opens a
 * session. Loading the model costs hundreds of megabytes for minutes, so only
 * a Tool the user already allowed to transcribe may trigger it; every other
 * Tool gets the refusal message to surface, and the model stays down until a
 * session is opened and consent is asked for.
 */
export function warmUpRefusal(input: {
  transcriptionEnabled: boolean;
  consent: 'granted' | 'denied' | undefined;
}): string | undefined {
  if (!input.transcriptionEnabled) return 'Transcription is disabled in Moss settings';
  if (input.consent !== 'granted') {
    return 'Warm-up needs the user’s transcription consent for this Tool; open a session first';
  }
  return undefined;
}
