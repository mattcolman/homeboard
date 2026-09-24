import type { Artifact, ContentValue } from '../widgets/model';

// Dev-only helpers for replaying the voice → artifact flow without the realtime
// model or artifact generation. Imported from the board behind a NODE_ENV
// check so production builds drop it.

export const SIM_QUERY = 'How do plants grow?';

/**
 * A silent, speech-like audio stream: a filtered sawtooth gated into
 * syllables with varying pitch and formant. It is never connected to the
 * speakers — it exists only so the waveform analyser has real signal.
 */
export function syntheticVoice(pitch: number, seconds: number) {
  const ctx = new AudioContext(),
    out = ctx.createMediaStreamDestination(),
    osc = ctx.createOscillator(),
    formant = ctx.createBiquadFilter(),
    gain = ctx.createGain();
  osc.type = 'sawtooth';
  formant.type = 'bandpass';
  formant.Q.value = 1.1;
  gain.gain.value = 0;
  osc.connect(formant).connect(gain).connect(out);
  const start = ctx.currentTime + 0.05;
  for (let at = start, n = 0; at < start + seconds; n++) {
    const length = 0.1 + Math.random() * 0.12;
    osc.frequency.setValueAtTime(pitch * (0.85 + Math.random() * 0.35), at);
    formant.frequency.setValueAtTime(450 + Math.random() * 1600, at);
    gain.gain.setTargetAtTime(0.5 + Math.random() * 0.5, at, 0.025);
    gain.gain.setTargetAtTime(0.02, at + length, 0.035);
    // Word gaps every few syllables.
    at += length + 0.05 + (n % 4 === 3 ? 0.18 : 0);
  }
  osc.start();
  void ctx.resume().catch(() => {});
  return {
    stream: out.stream,
    stop: () => {
      osc.stop();
      void ctx.close().catch(() => {});
    },
  };
}

const content = (value: Partial<ContentValue>): ContentValue => ({
  text: '',
  label: '',
  value: '',
  items: [],
  ...value,
});

/** The newest real artifact so the replay shows genuine content. */
export async function latestArtifact(): Promise<Artifact> {
  try {
    const list = (await fetch('/api/artifacts?scope=recent', {
      cache: 'no-store',
    }).then((r) => r.json())) as { artifacts?: Artifact[] };
    if (list.artifacts?.[0]) return list.artifacts[0];
  } catch {}
  return simulatedArtifact();
}

/** Used when the gallery is empty; never persisted. */
export function simulatedArtifact(): Artifact {
  const now = new Date().toISOString(),
    expires = new Date(Date.now() + 24 * 3600e3).toISOString();
  return {
    id: 'simulated',
    title: 'How plants grow',
    query: SIM_QUERY,
    definition: {
      schema: 1,
      theme: 1,
      kind: 'composition',
      tone: 'emerald',
      summary: 'From seed to plant: germination, roots, leaves and light.',
      nodes: [
        { id: 'intro', type: 'callout', children: [] },
        { id: 'steps', type: 'steps', children: [] },
        {
          id: 'facts',
          type: 'columns',
          children: [
            { id: 'light', type: 'metric', children: [] },
            { id: 'water', type: 'metric', children: [] },
          ],
        },
      ],
    },
    snapshot: {
      data: {
        content: {
          intro: content({
            text: 'Plants turn light, water and air into food — and use it to grow.',
          }),
          steps: content({
            items: [
              { label: 'Germination', value: 'The seed soaks up water and splits open.' },
              { label: 'Roots', value: 'Roots anchor the plant and draw up water and nutrients.' },
              { label: 'Shoot and leaves', value: 'A shoot climbs toward the light and unfolds leaves.' },
              { label: 'Photosynthesis', value: 'Leaves use sunlight to make sugar from CO₂ and water.' },
              { label: 'Growth', value: 'That sugar builds new cells, flowers and seeds.' },
            ],
          }),
          light: content({ label: 'Light', value: '6–8 h', text: 'of sun a day for most garden plants' }),
          water: content({ label: 'Water', value: '~90%', text: 'of a leaf is water' }),
        },
      },
      source: 'Simulated visual (dev mode)',
      sources: [],
      fetchedAt: now,
      staleAt: null,
      expiresAt: null,
    },
    state: {},
    promotedWidgetId: null,
    createdAt: now,
    expiresAt: expires,
    saved: false,
  };
}
