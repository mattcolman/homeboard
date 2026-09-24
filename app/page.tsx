'use client';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ArrowLeft,
  FlaskConical,
  Keyboard,
  LoaderCircle,
  Mic,
  MicOff,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import {
  WidgetBoard,
  type WidgetAction,
} from './components/widgets/WidgetBoard';
import {
  clearOffline,
  clearPending,
  readOffline,
  saveOffline,
  saveOfflineStep,
} from './lib/widgets/offline';
import {
  relativeTime,
  stepId,
  type Artifact,
  type Board,
  type Widget,
  type WidgetState,
} from './lib/widgets/model';
import { ArtifactView } from './components/widgets/ArtifactView';
import type { Recipe } from './lib/recipes';
import {
  calendarEventsForRange,
  type CalendarRange,
} from './lib/calendar/local';
import LegacyHome from './legacy-home';
import { SiteNav } from './components/SiteNav';
import { VoiceWave } from './components/VoiceWave';
import './widgets.css';

type Voice =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';
const voiceCopy: Record<Voice, string> = {
  idle: 'Ask Homeboard',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  error: 'Try voice again',
};
// On for `npm run dev`; the production build inlines this to false.
const DEV_MODE = process.env.NODE_ENV !== 'production';
// A quiet stretch while listening ends the session — the mic never sits hot
// behind a modal or after a finished answer.
const VOICE_IDLE_MS = 15000;
export default function Homeboard() {
  const [board, setBoard] = useState<Board | null>(null),
    [loading, setLoading] = useState(true),
    [offline, setOffline] = useState(false),
    [message, setMessage] = useState(''),
    [focusId, setFocusId] = useState<string | null>(null),
    [busy, setBusy] = useState<Set<string>>(new Set()),
    [generating, setGenerating] = useState(false),
    [voice, setVoice] = useState<Voice>('idle'),
    [typed, setTyped] = useState(false),
    [query, setQuery] = useState(''),
    [choices, setChoices] = useState<Recipe[] | null>(null),
    [lastRemoved, setLastRemoved] = useState<Widget | null>(null),
    [artifact, setArtifact] = useState<Artifact | null>(null),
    [recent, setRecent] = useState<Artifact[]>([]),
    [visualQuery, setVisualQuery] = useState<string | null>(null),
    [micStream, setMicStream] = useState<MediaStream | null>(null),
    [replyStream, setReplyStream] = useState<MediaStream | null>(null);
  const legacy = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(location.search).get('legacy') === '1',
    () => false,
  );
  const boardRef = useRef<Board | null>(null),
    focusRef = useRef<string | null>(null),
    offlineRef = useRef(false),
    choicesRef = useRef<Recipe[]>([]),
    artifactRef = useRef<Artifact | null>(null),
    peer = useRef<RTCPeerConnection | null>(null),
    channel = useRef<RTCDataChannel | null>(null),
    stream = useRef<MediaStream | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    loadSeq = useRef(0),
    mutationSeq = useRef(0),
    toolRef = useRef<
      (item: {
        name?: string;
        arguments?: string;
        call_id?: string;
      }) => Promise<void>
    >(async () => {}),
    voiceQueue = useRef<Promise<unknown>>(Promise.resolve()),
    seenCalls = useRef(new Set<string>()),
    voiceRef = useRef<Voice>('idle'),
    lastVoiceActivity = useRef(0),
    meterCtx = useRef<AudioContext | null>(null),
    meter = useRef<AnalyserNode | null>(null),
    voiceBar = useRef<HTMLDivElement>(null),
    simRun = useRef(0),
    simStop = useRef<(() => void) | null>(null);
  const showFocus = (id: string | null) => {
    focusRef.current = id;
    setFocusId(id);
    setChoices(null);
  };
  const showArtifact = (a: Artifact | null) => {
    artifactRef.current = a;
    setArtifact(a);
    if (a) {
      showFocus(null);
      setChoices(null);
    }
  };

  const signedOut = useRef(false),
    requestDialog = useRef<HTMLDialogElement>(null);
  const commitBoard = useCallback((next: Board) => {
    if (signedOut.current) return;
    boardRef.current = next;
    setBoard(next);
    if (!offlineRef.current) void saveOffline(next).catch(() => {});
  }, []);
  const replaceWidget = (widget: Widget) => {
    const current = boardRef.current;
    if (!current) return;
    const exists = current.widgets.some((w) => w.id === widget.id);
    commitBoard({
      ...current,
      widgets: exists
        ? current.widgets.map((w) => (w.id === widget.id ? widget : w))
        : [...current.widgets, widget],
    });
  };
  const loadBoard = useCallback(async () => {
    const seq = ++loadSeq.current,
      startedAt = mutationSeq.current;
    try {
      const response = await fetch('/api/widgets', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) {
        await clearOffline();
        navigator.serviceWorker?.controller?.postMessage(
          'CLEAR_HOMEBOARD_CACHE',
        );
        boardRef.current = null;
        setBoard(null);
        throw Error('Sign in to open your Homeboard.');
      }
      const data = (await response.json()) as Board & { error?: string };
      if (!response.ok)
        throw Error(data.error || 'Your board could not be loaded.');
      if (seq !== loadSeq.current || startedAt !== mutationSeq.current) return;
      const saved = await readOffline();
      if (
        seq !== loadSeq.current ||
        startedAt !== mutationSeq.current ||
        signedOut.current
      )
        return;
      offlineRef.current = false;
      setOffline(false);
      if (saved && saved.board.cacheScope !== data.cacheScope)
        await clearOffline();
      if (
        saved?.board.cacheScope === data.cacheScope &&
        Object.keys(saved.pending).length
      ) {
        const resolved: string[] = [];
        for (const [id, pending] of Object.entries(saved.pending)) {
          if (
            seq !== loadSeq.current ||
            startedAt !== mutationSeq.current ||
            signedOut.current
          )
            return;
          const widget = data.widgets.find((w) => w.id === id);
          if (!widget || widget.revision !== pending.revision) {
            resolved.push(id);
            setMessage(
              'A recipe changed while this device was offline. The latest saved progress is shown.',
            );
            continue;
          }
          if (
            !widget.snapshot.data.recipe?.steps.some(
              (s) => stepId(s) === pending.stepId,
            )
          ) {
            resolved.push(id);
            continue;
          }
          const r = await fetch('/api/widgets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'state',
              id,
              revision: widget.revision,
              mutationId: crypto.randomUUID(),
              state: { ...widget.state, stepId: pending.stepId },
            }),
          });
          if (r.ok) {
            resolved.push(id);
            const { widget: updated } = (await r.json()) as { widget: Widget };
            data.widgets = data.widgets.map((w) => (w.id === id ? updated : w));
          } else
            setMessage(
              'Offline cooking progress could not be saved yet. Homeboard will retry when your board updates.',
            );
        }
        await clearPending(resolved);
      }
      if (
        seq !== loadSeq.current ||
        startedAt !== mutationSeq.current ||
        signedOut.current
      )
        return;
      commitBoard(data);
    } catch (error) {
      if (seq !== loadSeq.current || signedOut.current) return;
      if (!navigator.onLine) {
        const saved = await readOffline();
        offlineRef.current = true;
        setOffline(true);
        if (saved) {
          boardRef.current = saved.board;
          setBoard(saved.board);
        }
        setMessage(
          saved?.board.widgets.length
            ? 'Offline · showing the copies you allowed on this device.'
            : 'Connect to open your board. You can allow individual widgets to be read offline from their options.',
        );
      } else
        setMessage(
          error instanceof Error
            ? error.message
            : 'Your board could not be loaded.',
        );
    }
  }, [commitBoard]);
  const loadRecent = useCallback(async () => {
    try {
      const response = await fetch('/api/artifacts?scope=recent', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = (await response.json()) as { artifacts?: Artifact[] };
      setRecent(data.artifacts ?? []);
    } catch {
      // Recent answers are optional; keep what we have.
    }
  }, []);
  useEffect(() => {
    const dialog = requestDialog.current;
    if (typed && !dialog?.open) dialog?.showModal();
    else if (!typed && dialog?.open) dialog.close();
  }, [typed]);
  useEffect(() => {
    void Promise.resolve()
      .then(loadBoard)
      .finally(() => setLoading(false));
    void Promise.resolve().then(loadRecent);
    const wake = () => {
      if (document.visibilityState === 'visible') void loadBoard();
    };
    const online = () => {
      setMessage('Back online. Updating your board…');
      void loadBoard();
    };
    const lost = () => {
      offlineRef.current = true;
      setOffline(true);
      setMessage(
        'You’re offline. New requests and shopping changes will wait until you reconnect.',
      );
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', online);
    window.addEventListener('offline', lost);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine)
        void loadBoard();
    }, 60000);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      void navigator.serviceWorker
        .register('/sw.js')
        .then(async () => {
          await navigator.serviceWorker.ready;
          navigator.serviceWorker.controller?.postMessage({
            type: 'CACHE_SHELL',
            assets: performance.getEntriesByType('resource').map((r) => r.name),
          });
        })
        .catch(() => {});
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', lost);
    };
  }, [loadBoard, loadRecent]);
  async function api(
    input: Record<string, unknown>,
  ): Promise<{ widget: Widget; reused?: boolean }> {
    const response = await fetch('/api/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await response.json()) as {
      widget: Widget;
      error?: string;
      reused?: boolean;
    };
    if (!response.ok) {
      if (response.status === 409) await loadBoard();
      if (response.status === 401 || response.status === 403) {
        await clearOffline();
        commitBoard({
          widgets: [],
          members: [],
          eventPeople: [],
          cacheScope: '',
          serverTime: new Date().toISOString(),
        });
      }
      throw Error(data.error || 'That change could not be saved.');
    }
    return data;
  }
  async function artifactApi(input: Record<string, unknown>) {
    const response = await fetch('/api/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await response.json()) as {
      artifact?: Artifact;
      widget?: Widget;
      error?: string;
    };
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await clearOffline();
        commitBoard({
          widgets: [],
          members: [],
          eventPeople: [],
          cacheScope: '',
          serverTime: new Date().toISOString(),
        });
      }
      throw Error(data.error || 'That visual could not be saved.');
    }
    return data;
  }
  async function showVisual(query: string) {
    if (offlineRef.current) throw Error('Reconnect to ask for a visual.');
    // Close any open visual so a fresh request re-morphs from the mic popup.
    showArtifact(null);
    setVisualQuery(query);
    setGenerating(true);
    setMessage('Putting together a visual…');
    try {
      const result = await artifactApi({ action: 'create', query });
      showArtifact(result.artifact!);
      void loadRecent();
      setMessage('Here’s your visual. Say “save it” to keep it.');
      return result.artifact!;
    } finally {
      setVisualQuery(null);
      setGenerating(false);
    }
  }
  async function refineArtifactView(a: Artifact, instruction: string) {
    setGenerating(true);
    try {
      const result = await artifactApi({
        action: 'refine',
        id: a.id,
        instruction,
      });
      showArtifact(result.artifact!);
      setMessage('Visual updated.');
      return result.artifact!;
    } finally {
      setGenerating(false);
    }
  }
  async function saveArtifactView(a: Artifact) {
    const result = await artifactApi({ action: 'save', id: a.id });
    showArtifact(result.artifact!);
    void loadRecent();
    setMessage('Saved to your Artifacts.');
    return result.artifact!;
  }
  async function dismissArtifactView(a: Artifact) {
    await artifactApi({ action: 'dismiss', id: a.id });
    showArtifact(null);
    void loadRecent();
  }
  const action: WidgetAction = (widget, kind, args = {}) => {
    const execute = async () => {
      const current =
        boardRef.current?.widgets.find((w) => w.id === widget.id) ?? widget;
      if (offlineRef.current) {
        if (
          kind === 'step' &&
          current.offlineAllowed &&
          current.snapshot.data.recipe
        ) {
          const steps = current.snapshot.data.recipe.steps,
            index = Math.max(
              0,
              steps.findIndex((s) => stepId(s) === current.state.stepId),
            ),
            jump =
              typeof args.stepId === 'string'
                ? steps.findIndex((s) => stepId(s) === args.stepId)
                : -1,
            next =
              jump >= 0
                ? jump
                : Math.max(
                    0,
                    Math.min(
                      steps.length - 1,
                      index + (args.direction === 'previous' ? -1 : 1),
                    ),
                  ),
            id = stepId(steps[next]);
          const updated = {
            ...current,
            state: { ...current.state, stepId: id },
          };
          replaceWidget(updated);
          await saveOfflineStep(current, id);
          return updated;
        }
        setMessage('Reconnect to save this change.');
        return;
      }
      ++mutationSeq.current;
      setBusy((prev) => new Set(prev).add(widget.id));
      try {
        const result = await api({
          id: current.id,
          revision: current.revision,
          mutationId: crypto.randomUUID(),
          action: kind,
          ...args,
        });
        replaceWidget(result.widget);
        if (kind === 'save_recipe') {
          await loadBoard();
          setMessage('Recipe saved to your recipes.');
        }
        if (kind === 'remove') {
          setLastRemoved(result.widget);
          if (focusRef.current === current.id) showFocus(null);
          setMessage('Widget removed. You can undo this.');
        } else if (kind === 'keep') setMessage('Kept on your board.');
        else if (kind === 'offline')
          setMessage(
            args.allowed
              ? 'A copy is allowed on this device for offline reading.'
              : 'The offline copy has been removed.',
          );
        else if (kind === 'refresh') setMessage('Widget updated.');
        else if (kind === 'refine' || kind === 'undo')
          setMessage('Widget updated. Your progress has been kept.');
        return result.widget;
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'That change could not be saved.',
        );
        return undefined;
      } finally {
        ++mutationSeq.current;
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(widget.id);
          return next;
        });
      }
    };
    const promise = queue.current.then(execute, execute);
    queue.current = promise;
    return promise;
  };
  async function create(query: string) {
    if (offlineRef.current) throw Error('Reconnect to create a new widget.');
    setGenerating(true);
    setMessage('Making a useful widget…');
    try {
      const result = await api({ action: 'resolve', query });
      ++mutationSeq.current;
      replaceWidget(result.widget);
      showFocus(result.widget.id);
      setMessage(
        result.reused
          ? 'Here’s your saved widget.'
          : 'Your new widget is ready. Say “keep this” to pin it.',
      );
      return result;
    } finally {
      setGenerating(false);
    }
  }
  async function openRecipe(recipe: Recipe) {
    try {
      const result = await api({
        action: 'recipe',
        recipeUrl: recipe.canonicalUrl,
        recipe,
      });
      ++mutationSeq.current;
      replaceWidget(result.widget);
      showFocus(result.widget.id);
      setMessage(`Ready to cook ${recipe.title}.`);
      return result.widget;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The recipe could not be opened.',
      );
      return undefined;
    }
  }
  async function addShopping(widget: Widget) {
    const list = boardRef.current?.widgets.find(
      (w) => w.definition.kind === 'shopping' && !w.archived,
    );
    if (!list)
      throw Error('Restore your shopping widget before adding ingredients.');
    const ingredients = widget.snapshot.data.recipe?.ingredients ?? [];
    const result = await action(list, 'add_items', {
      items: ingredients,
      source: 'recipe',
    });
    if (!result) throw Error('The shopping list was not changed.');
    setMessage('Ingredients added to your shopping list.');
    return result;
  }
  function selected(id?: unknown) {
    const widgets = boardRef.current?.widgets.filter((w) => !w.archived) ?? [];
    if (typeof id === 'string' && id) {
      const matches = widgets.filter(
        (w) => w.id === id || w.title.toLowerCase() === id.toLowerCase(),
      );
      if (matches.length === 1) return matches[0];
      throw Error('That widget is not on the board.');
    }
    const focused = widgets.find((w) => w.id === focusRef.current);
    if (focused) return focused;
    throw Error(
      'Ask which widget the user means. No widget is currently selected.',
    );
  }
  function stop() {
    ++simRun.current;
    simStop.current?.();
    simStop.current = null;
    peer.current?.close();
    channel.current?.close();
    stream.current?.getTracks().forEach((t) => t.stop());
    if (audio.current) audio.current.srcObject = null;
    peer.current = null;
    channel.current = null;
    stream.current = null;
    audio.current = null;
    setMicStream(null);
    setReplyStream(null);
    meterCtx.current?.close().catch(() => {});
    meterCtx.current = null;
    meter.current = null;
    setVoice('idle');
  }
  useEffect(
    () => () => {
      peer.current?.close();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && artifactRef.current) showArtifact(null);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  // End the session after a quiet stretch. Only fires while listening — never
  // mid-thought or mid-reply — and live mic audio keeps it alive, so it can't
  // cut off someone mid-sentence.
  useEffect(() => {
    const idle = window.setInterval(() => {
      if (!peer.current || voiceRef.current !== 'listening') return;
      const analyser = meter.current;
      if (analyser) {
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        for (const v of buf)
          if (Math.abs(v - 128) > 4) {
            lastVoiceActivity.current = Date.now();
            break;
          }
      }
      if (Date.now() - lastVoiceActivity.current > VOICE_IDLE_MS) {
        stop();
        setMessage('Voice off after a quiet spell — tap the mic to talk.');
      }
    }, 1000);
    return () => window.clearInterval(idle);
  }, []);
  function reply(callId: string | undefined, output: unknown) {
    if (!callId || channel.current?.readyState !== 'open') return;
    channel.current.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(output),
        },
      }),
    );
    channel.current.send(JSON.stringify({ type: 'response.create' }));
  }
  const handleTool = async (item: {
    name?: string;
    arguments?: string;
    call_id?: string;
  }) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(item.arguments ?? '{}');
    } catch {
      reply(item.call_id, { error: 'Invalid request' });
      return;
    }
    try {
      let output: unknown = {};
      if (item.name === 'show_dashboard') {
        if (args.view === 'home') {
          showFocus(null);
          output = { displayed: 'board' };
        } else {
          const target = boardRef.current?.widgets.find(
            (w) =>
              !w.archived &&
              (args.view === 'recipes'
                ? w.definition.kind === 'library'
                : args.view === 'schedule'
                  ? w.title === 'Everyone’s day'
                  : args.view === 'weather'
                    ? w.definition.kind === 'weather'
                    : w.title === 'Monthly spending'),
          );
          if (!target) throw Error('That widget is not on the board.');
          showFocus(target.id);
          output = {
            displayed: target.title,
            example: args.view === 'spending',
          };
        }
      } else if (item.name === 'list_widgets') {
        output = {
          widgets: boardRef.current?.widgets
            .filter((w) => !w.archived)
            .map((w) => ({
              id: w.id,
              title: w.title,
              kind: w.definition.kind,
              pinned: w.pinned,
            })),
          focused: focusRef.current,
          visual: artifactRef.current
            ? { id: artifactRef.current.id, title: artifactRef.current.title }
            : null,
        };
      } else if (item.name === 'create_widget') {
        const result = await create(
          typeof args.query === 'string' ? args.query : '',
        );
        output = {
          created: true,
          title: result.widget.title,
          id: result.widget.id,
        };
      } else if (item.name === 'show_visual') {
        try {
          const shown = await showVisual(
            typeof args.query === 'string' ? args.query : '',
          );
          output = {
            shown: true,
            title: shown.title,
            id: shown.id,
            summary: shown.definition.summary.slice(0, 300),
          };
        } catch (error) {
          const reason =
            error instanceof Error
              ? error.message
              : 'The visual could not be made.';
          setMessage(reason);
          output = { shown: false, fallback: true, reason };
        }
      } else if (item.name === 'control_visual') {
        const current = artifactRef.current;
        if (!current) throw Error('No visual is open. Ask what to show.');
        if (args.action === 'refine') {
          const updated = await refineArtifactView(
            current,
            typeof args.instruction === 'string' ? args.instruction : '',
          );
          output = { updated: updated.title };
        } else if (args.action === 'save') {
          const saved = await saveArtifactView(current);
          output = { saved: true, title: saved.title };
        } else if (args.action === 'close') {
          showArtifact(null);
          output = { closed: true };
        } else throw Error('That action is not supported.');
      } else if (item.name === 'control_widget') {
        if (args.action === 'board') {
          showFocus(null);
          output = { displayed: 'board' };
        } else if (!args.widget && artifactRef.current) {
          const current = artifactRef.current;
          if (args.action === 'keep') {
            // "Keep this" over a visual means save it — promotion is gone.
            const saved = await saveArtifactView(current);
            output = { saved: true, title: saved.title };
          } else if (args.action === 'refine') {
            const updated = await refineArtifactView(
              current,
              typeof args.instruction === 'string' ? args.instruction : '',
            );
            output = { updated: updated.title };
          } else if (args.action === 'remove') {
            await dismissArtifactView(current);
            output = { updated: current.title };
          } else {
            const widget = selected(args.widget);
            const result = await action(widget, String(args.action), {
              size: args.size,
              instruction: args.instruction,
              tone: args.tone === 'auto' ? null : args.tone,
            });
            if (!result) throw Error('The widget could not be updated.');
            output = { updated: result.title };
          }
        } else {
          const widget = selected(args.widget);
          if (args.action === 'focus') {
            showFocus(widget.id);
            output = { focused: widget.title };
          } else {
            const result = await action(widget, String(args.action), {
              size: args.size,
              instruction: args.instruction,
              tone: args.tone === 'auto' ? null : args.tone,
            });
            if (!result) throw Error('The widget could not be updated.');
            output = { updated: result.title };
          }
        }
      } else if (
        item.name === 'find_recipes' ||
        item.name === 'find_saved_recipe'
      ) {
        setGenerating(true);
        setMessage(
          item.name === 'find_recipes'
            ? 'Looking for a recipe…'
            : 'Opening your favourites…',
        );
        try {
          const request =
            item.name === 'find_recipes'
              ? await fetch('/api/recipes/search', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    query: typeof args.query === 'string' ? args.query : '',
                  }),
                })
              : await fetch(
                  `/api/recipes?q=${encodeURIComponent(typeof args.query === 'string' ? args.query : '')}`,
                  { cache: 'no-store' },
                );
          const data = (await request.json()) as {
            recipes?: Recipe[];
            error?: string;
          };
          if (!request.ok)
            throw Error(data.error || 'The recipes could not be loaded.');
          choicesRef.current = data.recipes ?? [];
          setChoices(choicesRef.current);
          output = {
            recipes: choicesRef.current.map((r, i) => ({
              option: i + 1,
              title: r.title,
              source: r.sourceName,
            })),
          };
          setMessage(
            choicesRef.current.length
              ? 'Choose a recipe, or say its number.'
              : 'No saved recipes matched that request.',
          );
        } finally {
          setGenerating(false);
        }
      } else if (item.name === 'choose_recipe') {
        const recipe = choicesRef.current[Number(args.option) - 1];
        if (!recipe) throw Error('That recipe option is not available.');
        const result = await openRecipe(recipe);
        if (!result) throw Error('The recipe could not be opened.');
        output = { selected: result.title };
      } else if (item.name === 'move_recipe_step') {
        const result = await action(selected(), 'step', {
          direction: args.direction,
        });
        if (!result) throw Error('The cooking step could not be changed.');
        output = { moved: true, step: result.state.stepId };
      } else if (item.name === 'save_current_recipe') {
        const widget = selected(),
          recipe = widget.snapshot.data.recipe;
        if (!recipe) throw Error('Choose a recipe first.');
        const response = await fetch('/api/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...recipe,
            familyNote:
              typeof args.note === 'string' ? args.note : recipe.familyNote,
          }),
        });
        if (!response.ok) throw Error('The recipe could not be saved.');
        await action(widget, 'keep');
        const library = boardRef.current?.widgets.find(
          (w) => w.definition.kind === 'library',
        );
        if (library) await action(library, 'refresh');
        output = { saved: true, title: recipe.title };
      } else if (item.name === 'add_recipe_to_shopping') {
        await addShopping(selected());
        output = { added: true };
      } else if (item.name === 'add_shopping_items') {
        const list = boardRef.current?.widgets.find(
          (w) => w.definition.kind === 'shopping' && !w.archived,
        );
        if (!list) throw Error('Restore your shopping widget first.');
        const result = await action(list, 'add_items', { items: args.items });
        if (!result) throw Error('The shopping list was not changed.');
        output = { added: true };
      } else if (item.name === 'add_chore') {
        const list = boardRef.current?.widgets.find(
          (w) => w.definition.kind === 'chores' && !w.archived,
        );
        if (!list) throw Error('Restore your chores widget first.');
        const result = await action(list, 'add_chores', {
          items: [{ text: args.text, member: args.member }],
        });
        if (!result) throw Error('The chores list was not changed.');
        output = { added: true };
      } else if (item.name === 'get_calendar_events') {
        const calendar = boardRef.current?.widgets.find(
          (widget) => !widget.archived && widget.definition.kind === 'calendar',
        );
        if (!calendar?.snapshot.data.calendarConnected) {
          output = {
            connected: false,
            events: [],
            message: 'iCloud Calendar is not connected.',
          };
        } else {
          output = {
            connected: true,
            updatedAt: calendar.snapshot.fetchedAt,
            ...calendarEventsForRange(
              calendar.snapshot.data.calendarEvents ?? [],
              (args.range === 'today' ||
              args.range === 'tomorrow' ||
              args.range === 'upcoming'
                ? args.range
                : 'upcoming') as CalendarRange,
            ),
          };
          showFocus(calendar.id);
        }
      } else if (item.name === 'get_weather') {
        const widget = boardRef.current?.widgets.find(
          (w) => !w.archived && w.definition.kind === 'weather',
        );
        const weather = widget?.snapshot.data.weather;
        if (!widget || !weather) {
          output = {
            available: false,
            message: 'The weather forecast is not on the board yet.',
          };
        } else {
          output = {
            available: true,
            place: weather.place,
            updatedAt: widget.snapshot.fetchedAt,
            now: {
              temperature: Math.round(weather.temperature),
              feelsLike: Math.round(weather.feelsLike),
              condition: weather.condition,
              windKmh: Math.round(weather.windKmh),
            },
            days: weather.days.map((day) => ({
              date: day.date,
              condition: day.condition,
              high: Math.round(day.high),
              low: Math.round(day.low),
              rainChance: day.rainChance,
            })),
          };
          showFocus(widget.id);
        }
      } else throw Error('That action is not supported.');
      reply(item.call_id, output);
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : 'That request did not work.';
      setMessage(errorText);
      reply(item.call_id, { error: errorText });
    }
  };
  useEffect(() => {
    toolRef.current = handleTool;
  });
  async function startVoice() {
    if (voice !== 'idle' && voice !== 'error') {
      stop();
      return;
    }
    if (offlineRef.current) {
      setMessage('Voice needs an internet connection.');
      return;
    }
    setVoice('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error('Microphone access is not available in this browser.');
      const pc = new RTCPeerConnection(),
        sound = new Audio();
      peer.current = pc;
      audio.current = sound;
      sound.autoplay = true;
      sound.setAttribute('playsinline', '');
      pc.ontrack = (e) => {
        sound.srcObject = e.streams[0];
        setReplyStream(e.streams[0]);
        void sound.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          stop();
          setVoice('error');
          setMessage(
            'The voice connection was interrupted. Tap the microphone to reconnect.',
          );
        }
      };
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.current = media;
      setMicStream(media);
      const ctx = new AudioContext(),
        analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(media).connect(analyser);
      meterCtx.current = ctx;
      meter.current = analyser;
      lastVoiceActivity.current = Date.now();
      media.getAudioTracks().forEach((track) => pc.addTrack(track, media));
      const dc = pc.createDataChannel('oai-events');
      channel.current = dc;
      dc.onopen = () => {
        lastVoiceActivity.current = Date.now();
        setVoice('listening');
        dc.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text:
                    'Current visible widgets: ' +
                    JSON.stringify(
                      boardRef.current?.widgets
                        .filter((w) => !w.archived)
                        .map((w) => ({
                          id: w.id,
                          title: w.title,
                          kind: w.definition.kind,
                        })),
                    ) +
                    '; focused widget: ' +
                    focusRef.current +
                    '; household members: ' +
                    JSON.stringify(
                      (boardRef.current?.members ?? []).map((m) => m.name),
                    ),
                },
              ],
            },
          }),
        );
      };
      dc.onclose = () => setVoice('idle');
      dc.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type === 'input_audio_buffer.speech_started')
          setVoice('listening');
        if (
          data.type === 'input_audio_buffer.speech_stopped' ||
          data.type === 'response.created'
        )
          setVoice('thinking');
        if (
          data.type === 'response.output_audio.delta' ||
          data.type === 'response.audio.delta'
        )
          setVoice('speaking');
        if (data.type === 'response.done') setVoice('listening');
        // Any turn progress counts as activity; keepalive chatter does not.
        if (
          data.type === 'input_audio_buffer.speech_started' ||
          data.type === 'input_audio_buffer.speech_stopped' ||
          data.type === 'response.created' ||
          data.type === 'response.output_audio.delta' ||
          data.type === 'response.audio.delta' ||
          data.type === 'response.done' ||
          data.type === 'response.output_item.done'
        )
          lastVoiceActivity.current = Date.now();
        if (
          data.type === 'response.output_item.done' &&
          data.item?.type === 'function_call' &&
          !seenCalls.current.has(data.item.call_id)
        ) {
          seenCalls.current.add(data.item.call_id);
          voiceQueue.current = voiceQueue.current.then(() =>
            toolRef.current(data.item),
          );
        }
        if (data.type === 'error') {
          setVoice('error');
          setMessage(
            'Voice could not complete that request. Please try again.',
          );
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const response = await fetch('/api/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw Error(data.error || 'Voice could not connect.');
      }
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: await response.text(),
      });
    } catch (error) {
      stop();
      setVoice('error');
      setMessage(
        error instanceof Error ? error.message : 'Voice could not start.',
      );
    }
  }
  // Dev mode: replays mic → listening → visual popup → fullscreen artifact →
  // spoken reply with synthetic audio, without the realtime model.
  async function simulateVoice() {
    const run = ++simRun.current,
      sim = await import('./lib/dev/voice-sim');
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) =>
        setTimeout(
          () =>
            simRun.current === run ? resolve() : reject(Error('cancelled')),
          ms,
        ),
      );
    const speak = (pitch: number, seconds: number) => {
      simStop.current?.();
      const voiceSim = sim.syntheticVoice(pitch, seconds);
      simStop.current = voiceSim.stop;
      return voiceSim.stream;
    };
    showArtifact(null);
    try {
      setVoice('connecting');
      await wait(700);
      setMicStream(speak(140, 2.4));
      setVoice('listening');
      setMessage(`“${sim.SIM_QUERY}”`);
      await wait(2700);
      simStop.current?.();
      setMicStream(null);
      setVoice('thinking');
      await wait(700);
      setVisualQuery(sim.SIM_QUERY);
      setGenerating(true);
      setMessage('Putting together a visual…');
      const [found] = await Promise.all([sim.latestArtifact(), wait(3800)]);
      showArtifact(found);
      setVisualQuery(null);
      setGenerating(false);
      setMessage('Here’s your visual.');
      setReplyStream(speak(210, 2));
      setVoice('speaking');
      await wait(2300);
    } catch {
      setVisualQuery(null);
      setGenerating(false);
    } finally {
      if (simRun.current === run) {
        simStop.current?.();
        simStop.current = null;
        setMicStream(null);
        setReplyStream(null);
        setVoice('idle');
      }
    }
  }
  if (legacy) return <LegacyHome />;
  return (
    <main className="homeboard-app">
      <header className="homeboard-header">
        <button
          className="homeboard-brand"
          onClick={() => showFocus(null)}
          aria-label="Homeboard overview"
        >
          <span>
            <Sparkles />
          </span>
          <div>
            Homeboard<small>Your household, at a glance</small>
          </div>
        </button>
        <SiteNav />
        <div className="homeboard-header-actions">
          {offline && (
            <span className="offline-badge">
              <WifiOff />
              Offline
            </span>
          )}
          <button
            className="quiet-button"
            onClick={() => {
              setTyped(true);
              setQuery('');
            }}
          >
            <Plus />
            New widget
          </button>
          <Link
            className="connections-link"
            href="/family"
            aria-label="Family members"
          >
            <Users />
            <span>Family</span>
          </Link>
          <Link
            className="connections-link"
            href="/connections"
            aria-label="Household connections"
          >
            <Settings />
            <span>Connections</span>
          </Link>
          <button
            className="homeboard-account"
            onClick={(event) => {
              event.preventDefault();
              signedOut.current = true;
              ++loadSeq.current;
              stop();
              boardRef.current = null;
              setBoard(null);
              void clearOffline().finally(() => {
                navigator.serviceWorker?.controller?.postMessage(
                  'CLEAR_HOMEBOARD_CACHE',
                );
                location.assign('/signout-with-chatgpt?return_to=/');
              });
            }}
            aria-label="Sign out"
          >
            H
          </button>
        </div>
      </header>
      {choices ? (
        <section className="recipe-results">
          <button className="board-back" onClick={() => setChoices(null)}>
            <ArrowLeft />
            Your board
          </button>
          <div>
            {choices.length ? (
              choices.map((recipe, index) => (
                <button
                  key={recipe.canonicalUrl}
                  className="recipe-result"
                  onClick={() => void openRecipe(recipe)}
                >
                  <span className="widget-label">Option {index + 1}</span>
                  <h2>{recipe.title}</h2>
                  <p>{recipe.description}</p>
                  <small>
                    {recipe.sourceName}
                    {recipe.totalMinutes ? ` · ${recipe.totalMinutes} min` : ''}
                  </small>
                </button>
              ))
            ) : (
              <p>No recipes matched. Try a different request.</p>
            )}
          </div>
        </section>
      ) : board ? (
        <WidgetBoard
          widgets={board.widgets}
          members={board.members ?? []}
          focusId={focusId}
          onFocus={showFocus}
          action={action}
          onRecipe={(recipe) => void openRecipe(recipe)}
          onShopping={(widget) =>
            void addShopping(widget).catch((error) => setMessage(error.message))
          }
          offline={offline}
          busy={busy}
        />
      ) : (
        <section className="board-loading">
          {loading ? (
            <>
              <LoaderCircle className="spin" />
              <h1>Opening your board…</h1>
            </>
          ) : (
            <>
              <h1>Your board is unavailable</h1>
              <p>{message}</p>
              <button onClick={() => void loadBoard()}>Try again</button>
            </>
          )}
        </section>
      )}
      {!focusId && !artifact && !choices && !!recent.length && (
        <section className="recent-artifacts" aria-label="Recent answers">
          <h3>Recent answers</h3>
          <div>
            {recent.map((a) => (
              <div className="recent-card" key={a.id}>
                <button
                  className="recent-open"
                  onClick={() => showArtifact(a)}
                >
                  <span>{a.title}</span>
                  <small>
                    {relativeTime(a.createdAt)}
                    {a.saved ? ' · saved' : ''}
                  </small>
                </button>
                <button
                  className="recent-delete"
                  aria-label={`Delete ${a.title}`}
                  title="Delete this answer"
                  onClick={() =>
                    void dismissArtifactView(a).catch((error) =>
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'The answer could not be deleted.',
                      ),
                    )
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {!!board && !board.widgets.some((w) => !w.archived) && (
        <section className="empty-board">
          <h1>A little room for something useful.</h1>
          <p>Ask Homeboard a question to create your first widget.</p>
        </section>
      )}
      <div className="homeboard-bottom">
        <output className="board-message" aria-live="polite">
          {generating && <LoaderCircle className="spin" />}
          {message}
          {lastRemoved && (
            <button
              onClick={() => {
                void action(lastRemoved, 'restore').then(() =>
                  setLastRemoved(null),
                );
              }}
            >
              <Undo2 />
              Undo
            </button>
          )}
        </output>
        <div
          ref={voiceBar}
          className={`homeboard-voice voice-${voice}${voice === 'idle' || voice === 'error' ? '' : ' is-live'}`}
        >
          <div className="mic-orb">
            <i className="mic-ring" aria-hidden />
            <i className="mic-ring" aria-hidden />
            <button
              className="homeboard-mic"
              aria-label={
                voice === 'idle' || voice === 'error'
                  ? 'Start voice request'
                  : 'Stop voice request'
              }
              onClick={() => void startVoice()}
              disabled={offline}
            >
              <span className="mic-light" aria-hidden>
                <i />
                <i />
              </span>
              {voice === 'idle' || voice === 'error' ? <Mic /> : <MicOff />}
            </button>
          </div>
          <div className="voice-stage">
            <span>{generating ? 'Working on it…' : voiceCopy[voice]}</span>
            {voice !== 'idle' && voice !== 'error' && (
              <VoiceWave
                mode={voice}
                mic={micStream}
                reply={replyStream}
                host={voiceBar}
              />
            )}
          </div>
          {DEV_MODE && (
            <button
              className="homeboard-simulate"
              onClick={() => void simulateVoice()}
              disabled={voice !== 'idle' && voice !== 'error'}
              title="Dev mode: replay a voice request → visual without calling the model"
            >
              <FlaskConical />
              Simulate
            </button>
          )}
          <button
            className="homeboard-type"
            onClick={() => setTyped(!typed)}
            aria-label="Type a request"
            aria-expanded={typed}
          >
            <Keyboard />
          </button>
        </div>
      </div>
      <dialog
        ref={requestDialog}
        className="request-overlay"
        onCancel={() => setTyped(false)}
        aria-labelledby="request-title"
      >
        <form
          className="request-dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (!query.trim()) return;
            const request = query,
              submitter = (e.nativeEvent as SubmitEvent)
                .submitter as HTMLElement | null;
            setTyped(false);
            setQuery('');
            const pending =
              submitter?.dataset.mode === 'board'
                ? create(request)
                : showVisual(request).then(() => undefined);
            void pending.catch((error) => setMessage(error.message));
          }}
        >
          <div>
            <h2 id="request-title">What would help?</h2>
            <button
              type="button"
              aria-label="Close request"
              onClick={() => setTyped(false)}
            >
              <X />
            </button>
          </div>
          <label htmlFor="widget-request">
            Ask a question, or make a widget for your board.
          </label>
          <textarea
            id="widget-request"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={1200}
            placeholder="Compare three trees for a small backyard…"
          />
          <div className="request-actions">
            <button
              className="primary-button"
              data-mode="visual"
              disabled={offline || generating || !query.trim()}
            >
              Show me
              <Sparkles />
            </button>
            <button
              className="quiet-button"
              data-mode="board"
              disabled={offline || generating || !query.trim()}
            >
              Add to board
            </button>
          </div>
        </form>
      </dialog>
      {(visualQuery !== null || artifact) && (
        <div className="artifact-overlay-root">
          <button
            className={`artifact-scrim${artifact ? ' is-on' : ''}`}
            aria-label="Close visual"
            tabIndex={artifact ? 0 : -1}
            onClick={() => artifact && showArtifact(null)}
          />
          <div
            className={`artifact-layer${artifact ? ' is-ready' : ''}`}
            role={artifact ? 'dialog' : 'status'}
            aria-modal={artifact ? true : undefined}
            aria-label={artifact ? artifact.title : 'Creating your visual'}
          >
            {artifact ? (
              <ArtifactView
                artifact={artifact}
                offline={offline}
                busy={generating}
                onClose={() => showArtifact(null)}
                onRefine={(instruction) =>
                  void refineArtifactView(artifact, instruction).catch(
                    (error) =>
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'The visual could not be updated.',
                      ),
                  )
                }
                onSave={() =>
                  void saveArtifactView(artifact).catch((error) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : 'The visual could not be saved.',
                    ),
                  )
                }
                onDelete={() =>
                  void dismissArtifactView(artifact).catch((error) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : 'The visual could not be deleted.',
                    ),
                  )
                }
                onState={(state: WidgetState) => {
                  void artifactApi({ action: 'state', id: artifact.id, state })
                    .then((result) => {
                      if (result.artifact) showArtifact(result.artifact);
                    })
                    .catch((error) =>
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'That change could not be saved.',
                      ),
                    );
                }}
              />
            ) : (
              <div className="artifact-loading">
                <span className="artifact-beam" aria-hidden />
                <header>
                  <Sparkles className="artifact-spark" />
                  <strong>Building your visual</strong>
                </header>
                <p className="artifact-loading-query">{visualQuery}</p>
                <div className="artifact-skeleton" aria-hidden>
                  <i className="sk-hero" />
                  <i />
                  <i />
                  <i className="sk-short" />
                </div>
                <footer>
                  <span className="artifact-pulse" aria-hidden />
                  Agent at work — composing pictures and layout
                </footer>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
