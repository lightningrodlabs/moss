# Capturing Audio Sources

Moss can hand a Tool the audio that plays on the user's computer: the system output or one application, chosen by the user in a picker that Moss shows. The Tool receives a `MediaStreamTrack` and uses it like a microphone track: play it, record it, send it over WebRTC, or feed it to [speech transcription](./transcription).

## When to use it

- Share the sound of a video or a music player during a call. Screen sharing alone carries no audio on most platforms.
- Transcribe a meeting or a recording that plays in another application.

Use `getUserMedia` for the microphone. This feature is only for audio that other software produces.

## Feature detection

`weaveClient.captureAudioSources` is optional. It is absent when:

- the host is older than Moss 0.16;
- the Audio Sources service is switched off under Settings > Services in Moss;
- the capture backend does not work on this computer.

Moss decides this when the Tool's iframe loads. Check the method before you show a button for it:

```ts
const canCapture = typeof weaveClient.captureAudioSources === 'function';
```

## Requesting a capture

```ts
const capture = await weaveClient.captureAudioSources?.();
if (!capture) return; // the user declined, or capture failed
```

Moss shows its own picker. The call resolves with `null` when the user declines or when the capture cannot start, so there is no permission to ask for beforehand.

The one option is `audioContext`. Pass your own `AudioContext` when it runs at 48 kHz and you want the track built in it. Otherwise Moss builds the track in a private 48 kHz context. A track from that private context still plays and records in your own context.

## What you get

| Field            | Meaning                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `track`          | A live mono `MediaStreamTrack` at 48 kHz. It ends when the capture ends.                                                    |
| `label`          | What the user chose, for example "System audio". Show it next to your stop button.                                          |
| `canExcludeSelf` | `false` when Moss could not keep its own playback out of the capture. Tell the user that echo is possible in a call.        |
| `stop()`         | Ends the capture from the Tool's side. Does not fire `onended`.                                                             |
| `onended`        | Set it to a function. It fires once when Moss or the platform ends the capture, for example when the user stops it in Moss. |
| `endedReason`    | Why the capture ended, set only when Moss or the platform ended it. `'host-silent'` means frames stopped arriving.          |
| `stats`          | Frame counters, refreshed about once per second. Useful for a diagnostics view.                                             |

## Ending a capture

Call `capture.stop()` when the user is done. When Moss ends the capture, `onended` fires and `track.readyState` becomes `'ended'`. Handle both, because a user can stop the capture from either side.

## Example: system audio in a WebRTC call

```ts
async function shareSystemAudio(peerConnection: RTCPeerConnection) {
  const capture = await weaveClient.captureAudioSources?.();
  if (!capture) return;

  const stream = new MediaStream([capture.track]);
  const sender = peerConnection.addTrack(capture.track, stream);

  if (!capture.canExcludeSelf) {
    showNotice('Your call audio may be included in the shared sound.');
  }

  capture.onended = () => {
    peerConnection.removeTrack(sender);
    showNotice(`${capture.label} stopped`);
  };

  return () => {
    capture.stop();
    peerConnection.removeTrack(sender);
  };
}
```

## Feeding the audio to transcription

Attach a `MediaStreamTrackProcessor` to `capture.track`, convert each `AudioData` chunk to PCM16, and push it to a transcription session. The [transcription guide](./transcription#converting-audiodata-to-pcm16) shows the conversion. Tell the session `sampleRate: 48000`.

## Reference

- [`WeaveClient.captureAudioSources`](/api-reference/api/api.weaveclient.captureaudiosources)
- [`AudioSourceCapture`](/api-reference/api/api.audiosourcecapture)
- [`CaptureAudioSourcesOptions`](/api-reference/api/api.captureaudiosourcesoptions)
