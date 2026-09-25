// Pure helpers for scripts/asr-diagnose.mjs: read the per-commit WAV and
// result dumps a Moss ASR session writes under MOSS_ASR_DUMP_DIR, stitch
// them back onto the session clock, and compare each commit's text with a
// reference transcript of the whole recording so the stage that lost
// speech can be named.

const DUMP_NAME = /^asr-(.+)-(\d{3})-at(\d+)ms-(\d+)ms\.wav$/;

/**
 * @typedef {{ tag: string, index: number, baseMs: number, durationMs: number }} DumpName
 * @typedef {{ text: string, tStart: number, tEnd: number }} CommitSegment
 * @typedef {{
 *   tag: string, index: number, baseMs: number, durationMs: number,
 *   sampleRate: number, channels: number, pcm: Int16Array,
 *   text: string, segments: CommitSegment[], error?: string,
 * }} Commit
 * @typedef {{ fromMs: number, toMs: number, text: string }} ReferenceSegment
 */

/** @param {string} name @returns {DumpName | null} */
export function parseDumpName(name) {
  const m = DUMP_NAME.exec(name);
  if (!m) return null;
  return { tag: m[1], index: Number(m[2]), baseMs: Number(m[3]), durationMs: Number(m[4]) };
}

/** @param {Int16Array} pcm @param {number} sampleRate @param {number} channels */
export function encodeWav(pcm, sampleRate, channels) {
  const dataLength = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataLength);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLength, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, 44);
  return buf;
}

/** @param {Buffer} buf @returns {{ sampleRate: number, channels: number, pcm: Int16Array }} */
export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (buf.readUInt16LE(body) !== 1 || buf.readUInt16LE(body + 14) !== 16) {
        throw new Error('only 16-bit PCM WAV is supported');
      }
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
    } else if (id === 'data') {
      const bytes = Math.min(size, buf.length - body);
      const pcm = new Int16Array(bytes / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readInt16LE(body + i * 2);
      return { sampleRate, channels, pcm };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** @param {Int16Array} pcm */
export function rmsOf(pcm) {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}

/**
 * Lay the commits back on the session clock. Gaps between commits are
 * audio the session dropped as pre-speech silence, so they become zeros.
 * @param {Commit[]} commits
 */
export function stitchCommits(commits) {
  const ordered = [...commits].sort((a, b) => a.baseMs - b.baseMs);
  const sampleRate = ordered[0]?.sampleRate ?? 16_000;
  const channels = ordered[0]?.channels ?? 1;
  const spanMs = ordered.reduce((m, c) => Math.max(m, c.baseMs + c.durationMs), 0);
  const pcm = new Int16Array(Math.round((spanMs / 1000) * sampleRate * channels));
  let gapsMs = 0;
  let cursorMs = 0;
  for (const c of ordered) {
    if (c.baseMs > cursorMs) gapsMs += c.baseMs - cursorMs;
    const at = Math.round((c.baseMs / 1000) * sampleRate * channels);
    pcm.set(c.pcm.subarray(0, Math.max(0, pcm.length - at)), at);
    cursorMs = Math.max(cursorMs, c.baseMs + c.durationMs);
  }
  return { pcm, sampleRate, channels, spanMs, gapsMs };
}

/**
 * @param {Commit[]} commits
 * @param {ReferenceSegment[]} reference
 * @returns {Array<Commit & { referenceText: string }>}
 */
export function alignReference(commits, reference) {
  return commits.map((c) => {
    const end = c.baseMs + c.durationMs;
    const text = reference
      .filter((r) => r.toMs > c.baseMs && r.fromMs < end)
      .map((r) => r.text.trim())
      .filter(Boolean)
      .join(' ');
    return { ...c, referenceText: text };
  });
}

const SPEECH_RMS = 0.01;
const PARTIAL_RECALL = 0.6;

/** @param {string} s */
function words(s) {
  return s
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Share of the reference words that also appear in the commit text.
 * @param {string} commitText @param {string} referenceText
 */
export function wordRecall(commitText, referenceText) {
  const ref = words(referenceText);
  if (ref.length === 0) return 1;
  const have = new Map();
  for (const w of words(commitText)) have.set(w, (have.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of ref) {
    const n = have.get(w) ?? 0;
    if (n > 0) {
      hit++;
      have.set(w, n - 1);
    }
  }
  return hit / ref.length;
}

/**
 * @param {Commit[]} commits
 * @param {ReferenceSegment[]} reference
 */
export function buildReport(commits, reference) {
  const aligned = alignReference(
    [...commits].sort((a, b) => a.baseMs - b.baseMs),
    reference,
  );
  const rows = aligned.map((c) => {
    const rms = rmsOf(c.pcm);
    const hasSpeech = rms >= SPEECH_RMS;
    const hasText = words(c.text).length > 0;
    const recall = wordRecall(c.text, c.referenceText);
    /** @type {'ok' | 'silence' | 'speech-no-text' | 'partial' | 'error'} */
    let verdict = 'ok';
    if (c.error) verdict = 'error';
    else if (!hasSpeech && !hasText) verdict = 'silence';
    else if (hasSpeech && !hasText) verdict = 'speech-no-text';
    else if (recall < PARTIAL_RECALL) verdict = 'partial';
    return {
      index: c.index,
      baseMs: c.baseMs,
      durationMs: c.durationMs,
      rms,
      text: c.text,
      referenceText: c.referenceText,
      wordRecall: recall,
      verdict,
      error: c.error,
    };
  });
  const sum = (pred) => rows.filter(pred).reduce((n, r) => n + r.durationMs, 0);
  const summary = {
    commits: rows.length,
    committedMs: sum(() => true),
    speechNoTextMs: sum((r) => r.verdict === 'speech-no-text'),
    partialMs: sum((r) => r.verdict === 'partial'),
    silenceMs: sum((r) => r.verdict === 'silence'),
    errorMs: sum((r) => r.verdict === 'error'),
  };
  return { rows, summary };
}

/** Render the report as Markdown. */
export function renderReport(report, extra = {}) {
  const ms = (n) => `${(n / 1000).toFixed(1)}s`;
  const lines = [];
  lines.push('# ASR commit diagnosis', '');
  for (const [k, v] of Object.entries(extra)) lines.push(`- ${k}: ${v}`);
  const s = report.summary;
  lines.push(
    `- commits: ${s.commits}`,
    `- audio committed: ${ms(s.committedMs)}`,
    `- speech with no text: ${ms(s.speechNoTextMs)}`,
    `- partial (under ${Math.round(PARTIAL_RECALL * 100)}% of reference words): ${ms(s.partialMs)}`,
    `- silence: ${ms(s.silenceMs)}`,
    `- errors: ${ms(s.errorMs)}`,
    '',
    '| # | at | dur | rms | verdict | recall | commit text | reference text |',
    '|---|----|-----|-----|---------|--------|-------------|----------------|',
  );
  for (const r of report.rows) {
    const cell = (t) => (t ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(
      `| ${r.index} | ${ms(r.baseMs)} | ${ms(r.durationMs)} | ${r.rms.toFixed(3)} | ${r.verdict} | ${(r.wordRecall * 100).toFixed(0)}% | ${cell(r.text)} | ${cell(r.referenceText)} |`,
    );
  }
  return lines.join('\n') + '\n';
}
