'use client';
import { useEffect, useRef, type RefObject } from 'react';

export type VoiceMode =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

const BARS = 44;
const PALETTES: Record<VoiceMode, [string, string, string]> = {
  idle: ['#5b8cff', '#7a5cff', '#b45cff'],
  error: ['#5b8cff', '#7a5cff', '#b45cff'],
  connecting: ['#5b8cff', '#7a5cff', '#b45cff'],
  listening: ['#22d3ee', '#4f7cff', '#8b5cf6'],
  thinking: ['#8b5cf6', '#c084fc', '#8b5cf6'],
  speaking: ['#fbbf24', '#fb7185', '#e879f9'],
};

// Live audio visualiser. Bars mirror out from the centre, driven by the mic
// while listening and by Homeboard's reply while speaking; between turns it
// idles on a gentle travelling wave. It also writes the smoothed loudness to
// `--level` on `host` so CSS can pulse the mic rings without re-rendering.
export function VoiceWave({
  mode,
  mic,
  reply,
  host,
}: {
  mode: VoiceMode;
  mic: MediaStream | null;
  reply: MediaStream | null;
  host: RefObject<HTMLElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    const el = canvas.current,
      ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches,
      bar = host.current;
    let audio = null as AudioContext | null;
    const tap = (stream: MediaStream | null) => {
      if (!stream?.getAudioTracks().length) return undefined;
      audio ??= new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      audio.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    };
    const sources = { listening: tap(mic), speaking: tap(reply) };
    void audio?.resume().catch(() => {});
    const bins = new Uint8Array(128),
      heights = new Float32Array(BARS);
    let frame = 0,
      level = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dpr = devicePixelRatio || 1,
        w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
      if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const m = modeRef.current,
        t = still ? 0 : now / 1000,
        source =
          m === 'listening' || m === 'speaking' ? sources[m] : undefined;
      if (source) source.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < BARS; i++) {
        // 0 at the centre, 1 at either edge — low (voice) frequencies sit in
        // the middle so speech blooms outward.
        const d = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
        const signal = source
          ? Math.pow(bins[Math.floor(2 + d * 46)] / 255, 1.35) * (1 - d * 0.3)
          : 0;
        const ambient =
          m === 'thinking'
            ? 0.16 + 0.12 * Math.sin(t * 6 - i * 0.42)
            : m === 'connecting'
              ? 0.08 + 0.07 * Math.sin(t * 3.5 + d * 9)
              : 0.05 + 0.035 * Math.sin(t * 2.4 - d * 7);
        const target = Math.max(signal, ambient);
        heights[i] += (target - heights[i]) * (target > heights[i] ? 0.5 : 0.1);
        sum += signal;
      }
      level += (sum / BARS - level) * 0.25;
      bar?.style.setProperty('--level', level.toFixed(3));
      const [a, b, c] = PALETTES[m],
        gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, a);
      gradient.addColorStop(0.5, b);
      gradient.addColorStop(1, c);
      const gap = w / BARS,
        barWidth = Math.max(2, gap * 0.52);
      ctx.fillStyle = gradient;
      ctx.shadowColor = b;
      ctx.shadowBlur = 6 + level * 26;
      ctx.beginPath();
      for (let i = 0; i < BARS; i++) {
        const bh = Math.max(3, heights[i] * (h - 6));
        ctx.roundRect(
          i * gap + (gap - barWidth) / 2,
          (h - bh) / 2,
          barWidth,
          bh,
          barWidth / 2,
        );
      }
      ctx.fill();
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      bar?.style.setProperty('--level', '0');
      void audio?.close().catch(() => {});
    };
  }, [mic, reply, host]);
  return <canvas ref={canvas} className="voice-wave" aria-hidden />;
}
