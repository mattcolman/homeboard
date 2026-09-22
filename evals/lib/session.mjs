// A realtime-session client for evals. Opens the same session the app creates
// (shared SESSION_CONFIG), but over a WebSocket with text turns instead of a
// WebRTC mic — so evals exercise the real instructions and tool decisions.
import WebSocket from 'ws';
import { SESSION_CONFIG } from '../../app/api/realtime/session.ts';
import { requireEnv } from './env.mjs';

const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${SESSION_CONFIG.model}`;
const TURN_TIMEOUT_MS = 240_000;

// Transcript entries keep every event except bulk audio, which is huge and
// irrelevant to evals.
function scrub(event) {
  if (typeof event?.delta === 'string' && event.delta.length > 200)
    return { ...event, delta: `<${event.delta.length} bytes>` };
  return event;
}

function replyText(item) {
  if (item.type !== 'message') return [];
  return (item.content ?? [])
    .map((part) => part.transcript ?? part.text ?? '')
    .filter(Boolean);
}

export class RealtimeSession {
  static async connect({ executor, log = () => {} }) {
    const session = new RealtimeSession(executor, log);
    await session.#open();
    return session;
  }

  #ws;
  #executor;
  #log;
  #turn = null;
  #queue = Promise.resolve();
  events = [];

  constructor(executor, log) {
    this.#executor = executor;
    this.#log = log;
  }

  #open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(REALTIME_URL, {
        headers: {
          Authorization: `Bearer ${requireEnv('OPENAI_API_KEY')}`,
        },
      });
      this.#ws = ws;
      const timer = setTimeout(
        () => reject(Error('Timed out opening the realtime session.')),
        30_000,
      );
      ws.on('open', () => {
        this.#send({ type: 'session.update', session: SESSION_CONFIG });
      });
      ws.on('message', (data) => {
        let event;
        try {
          event = JSON.parse(data.toString());
        } catch {
          return;
        }
        this.events.push(scrub(event));
        if (event.type === 'session.updated') {
          clearTimeout(timer);
          resolve();
        } else if (event.type === 'response.done') {
          void this.#finishResponse(event.response);
        } else if (event.type === 'error') {
          this.#log(`realtime error: ${event.error?.message ?? 'unknown'}`);
          if (this.#turn) {
            clearTimeout(this.#turn.timer);
            this.#turn.reject(
              Error(event.error?.message ?? 'Realtime session error.'),
            );
            this.#turn = null;
          }
        }
      });
      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      ws.on('close', () => {
        this.#turn?.reject(Error('The realtime session closed.'));
        this.#turn = null;
      });
    });
  }

  #send(payload) {
    this.#ws.send(JSON.stringify(payload));
  }

  // Mirrors the system context the client injects when the data channel opens
  // (app/page.tsx): current visible widgets + focused widget.
  sendSystemContext(text) {
    this.#send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text }],
      },
    });
  }

  say(text, timeoutMs = TURN_TIMEOUT_MS) {
    if (this.#turn) throw Error('A turn is already in progress.');
    return new Promise((resolve, reject) => {
      this.#turn = {
        replies: [],
        calls: [],
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#turn?.reject(
            Error(`No response within ${timeoutMs / 1000}s.`),
          );
          this.#turn = null;
        }, timeoutMs),
      };
      this.#send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });
      this.#send({ type: 'response.create' });
    });
  }

  async #finishResponse(response) {
    const turn = this.#turn;
    if (!turn) return;
    const items = Array.isArray(response?.output) ? response.output : [];
    for (const item of items) {
      if (item.type === 'function_call') turn.calls.push(item);
      else turn.replies.push(...replyText(item));
    }
    if (response?.status === 'failed' && !items.length) {
      const detail =
        response?.status_details?.error?.message ?? 'The response failed.';
      clearTimeout(turn.timer);
      this.#turn = null;
      turn.resolve({ replies: turn.replies, calls: turn.calls, error: detail });
      return;
    }
    const calls = items.filter((item) => item.type === 'function_call');
    if (!calls.length) {
      clearTimeout(turn.timer);
      this.#turn = null;
      turn.resolve({ replies: turn.replies, calls: turn.calls });
      return;
    }
    // Serialise tool execution like the client does (voiceQueue).
    this.#queue = this.#queue.then(async () => {
      for (const call of calls) {
        this.#log(`tool ${call.name} ${call.arguments ?? ''}`);
        call.output = await this.#executor.execute(call.name, call.arguments);
        this.#send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(call.output),
          },
        });
      }
      this.#send({ type: 'response.create' });
    });
    this.#queue.catch((error) => {
      turn.reject(error);
      this.#turn = null;
    });
  }

  close() {
    this.#turn?.reject(Error('Session closed by the eval.'));
    this.#turn = null;
    this.#ws?.close();
  }
}
