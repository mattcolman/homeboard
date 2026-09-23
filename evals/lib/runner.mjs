// Scenario runner: interprets steps, evaluates expectations, drives human
// handoffs, and writes a transcript + verdicts to evals/results/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { boardFromEnv } from './board.mjs';
import { ToolExecutor } from './tools.mjs';
import { RealtimeSession } from './session.mjs';
import { judge } from './judge.mjs';
import { missingCapabilities } from '../capabilities.mjs';
import { env } from './env.mjs';
import { actions } from '../actions/index.mjs';

const RESULTS_DIR = new URL('../results/', import.meta.url);

function describeStep(step) {
  if (step.say !== undefined) return `say "${step.say}"`;
  if (step.expect) return 'expect';
  if (step.expect_state) return 'expect_state';
  if (step.expect_artifact) return 'expect_artifact';
  if (step.action) return `action ${step.action}`;
  if (step.human) return 'human';
  if (step.run) return `run ${step.run}`;
  if (step.note) return 'note';
  return 'step';
}

function assertionName(assertion, index) {
  if (assertion.name) return assertion.name;
  if (assertion.judge) return `judge#${index + 1}`;
  if (assertion.tool_called) return 'tool_called';
  if (assertion.tool_not_called) return 'tool_not_called';
  if (assertion.no_tool_call) return 'no_tool_call';
  for (const key of Object.keys(assertion))
    if (key.startsWith('reply_')) return key;
  for (const key of [
    'exists',
    'binding_source',
    'snapshot_includes',
    'snapshot_not_includes',
  ])
    if (key in assertion) return key;
  return `assertion#${index + 1}`;
}

// ${facts.a.b} and ${env.KEY} interpolation inside strings.
function interpolate(value, ctx) {
  if (typeof value !== 'string') return { value, unresolved: [] };
  const unresolved = [];
  const out = value.replace(
    /\$\{(facts\.[\w.-]+|env\.[A-Za-z_]+)\}/g,
    (match, key) => {
      if (key.startsWith('env.')) return ctx.env(key.slice(4), match);
      let node = ctx.facts;
      for (const part of key.slice(6).split('.')) node = node?.[part];
      if (node === undefined) {
        unresolved.push(key);
        return match;
      }
      return String(node);
    },
  );
  return { value: out, unresolved };
}

function makeAsker(enabled) {
  if (!enabled) return null;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return async (instructions) => {
    stdout.write(`\n  HUMAN STEP: ${instructions}\n`);
    const answer = (
      await rl.question('  [Enter]=done  f=fail  s=skip > ')
    ).trim();
    if (answer.toLowerCase() === 'f') return 'failed';
    if (answer.toLowerCase() === 's') return 'skipped';
    return 'done';
  };
}

function matches(received, expected) {
  if (expected instanceof RegExp) return expected.test(received);
  return received.includes(String(expected));
}

export async function runScenario(scenario, options = {}) {
  const startedAt = new Date();
  const owner =
    options.owner ?? `eval-${scenario.id}-${startedAt.getTime().toString(36)}`;
  const board = boardFromEnv(owner);
  const executor = new ToolExecutor(board);
  const log = options.verbose ? (line) => console.log(`      ${line}`) : () => {};
  const ctx = {
    scenario,
    owner,
    board,
    executor,
    env,
    facts: {},
    turns: [],
    results: [],
    lastSay: null,
    lastTurn: null,
    log,
    askHuman: makeAsker(options.interactive !== false),
  };

  const record = (index, status, detail) => {
    ctx.results.push({ index, status, detail });
    const tag = status.toUpperCase().padEnd(8);
    console.log(`  ${tag} ${detail}`);
  };

  const evaluateAssertion = async (assertion, index) => {
    const name = assertionName(assertion, index);
    const missing = missingCapabilities(assertion.requires);
    if (missing.length)
      return record(
        index,
        'blocked',
        `${name} — ${missing.map((m) => m.detail).join('; ')}`,
      );

    const turn = ctx.lastTurn;
    const reply = (turn?.replies ?? []).join(' ');
    const calls = turn?.calls ?? [];

    if (assertion.judge) {
      const { value: rubric, unresolved } = interpolate(assertion.judge, ctx);
      if (unresolved.length)
        return record(index, 'blocked', `${name} — unresolved ${unresolved.join(', ')}`);
      if (!turn)
        return record(index, 'fail', `${name} — no assistant turn to judge`);
      const verdict = await judge(rubric, {
        user_said: ctx.lastSay,
        assistant_replies: turn.replies,
        tool_calls: calls.map((c) => ({
          name: c.name,
          arguments: c.arguments,
          output: c.output,
        })),
      });
      return record(
        index,
        verdict.pass ? 'pass' : 'fail',
        `${name} — ${verdict.reason}`,
      );
    }

    if (assertion.tool_called) {
      const wanted =
        typeof assertion.tool_called === 'string'
          ? { name: assertion.tool_called }
          : assertion.tool_called;
      const found = calls.some((c) => {
        if (c.name !== wanted.name) return false;
        if (!wanted.args) return true;
        let parsed = {};
        try {
          parsed = JSON.parse(c.arguments ?? '{}');
        } catch {
          return false;
        }
        return Object.entries(wanted.args).every(
          ([key, value]) =>
            JSON.stringify(parsed[key]) === JSON.stringify(value),
        );
      });
      return record(
        index,
        found ? 'pass' : 'fail',
        `${name} — expected tool ${wanted.name}; calls were [${calls
          .map((c) => c.name)
          .join(', ')}]`,
      );
    }

    if (assertion.tool_not_called) {
      const wanted = assertion.tool_not_called;
      const found = calls.some((c) => c.name === wanted);
      return record(
        index,
        found ? 'fail' : 'pass',
        `${name} — calls were [${calls.map((c) => c.name).join(', ')}]`,
      );
    }

    if (assertion.no_tool_call)
      return record(
        index,
        calls.length === 0 ? 'pass' : 'fail',
        `${name} — calls were [${calls.map((c) => c.name).join(', ')}]`,
      );

    if (assertion.reply_includes !== undefined) {
      const { value: needle, unresolved } = interpolate(
        assertion.reply_includes,
        ctx,
      );
      if (unresolved.length)
        return record(index, 'blocked', `${name} — unresolved ${unresolved.join(', ')}`);
      return record(
        index,
        reply.includes(needle) ? 'pass' : 'fail',
        `${name} — reply "${reply}"`,
      );
    }

    for (const [key, negate] of [
      ['reply_matches', false],
      ['reply_not_matches', true],
    ]) {
      if (assertion[key] === undefined) continue;
      const expected = assertion[key];
      const hit = matches(reply, expected);
      return record(
        index,
        hit !== negate ? 'pass' : 'fail',
        `${name} — reply "${reply}"`,
      );
    }

    if (assertion.reply_max_words !== undefined) {
      const count = reply.split(/\s+/).filter(Boolean).length;
      const ok = count <= assertion.reply_max_words;
      return record(
        index,
        ok ? 'pass' : 'fail',
        `${name} — ${count} words in "${reply}"`,
      );
    }

    return record(index, 'fail', `${name} — unknown assertion shape`);
  };

  const evaluateStateAssertion = async (assertion, index, widgets) => {
    const name = assertionName(assertion, index);
    const missing = missingCapabilities(assertion.requires);
    if (missing.length)
      return record(
        index,
        'blocked',
        `${name} — ${missing.map((m) => m.detail).join('; ')}`,
      );
    const widget = widgets.find((w) => {
      if (assertion.id) return w.id === assertion.id;
      if (assertion.title)
        return w.title.toLowerCase() === assertion.title.toLowerCase();
      if (assertion.kind) return w.definition.kind === assertion.kind;
      return false;
    });
    const exists = assertion.exists !== false;
    if (!widget)
      return record(
        index,
        exists ? 'fail' : 'pass',
        `${name} — widget ${assertion.title ?? assertion.kind ?? assertion.id} ${
          exists ? 'not found' : 'absent as expected'
        }`,
      );
    if (!exists) return record(index, 'fail', `${name} — widget exists`);

    // Every specified check must hold — collect failures across them.
    const failures = [];
    if (
      assertion.binding_source !== undefined &&
      widget.binding?.source !== assertion.binding_source
    )
      failures.push(`binding ${widget.binding?.source ?? 'none'}`);
    if (assertion.snapshot_includes !== undefined) {
      const { value: needle, unresolved } = interpolate(
        assertion.snapshot_includes,
        ctx,
      );
      if (unresolved.length)
        return record(index, 'blocked', `${name} — unresolved ${unresolved.join(', ')}`);
      if (!matches(JSON.stringify(widget.snapshot?.data ?? {}), needle))
        failures.push(
          `snapshot lacks ${needle instanceof RegExp ? needle : `"${needle}"`}`,
        );
    }
    if (assertion.snapshot_not_includes !== undefined) {
      const { value: needle, unresolved } = interpolate(
        assertion.snapshot_not_includes,
        ctx,
      );
      if (unresolved.length)
        return record(index, 'blocked', `${name} — unresolved ${unresolved.join(', ')}`);
      if (matches(JSON.stringify(widget.snapshot?.data ?? {}), needle))
        failures.push(
          `snapshot contains ${needle instanceof RegExp ? needle : `"${needle}"`}`,
        );
    }
    return record(
      index,
      failures.length ? 'fail' : 'pass',
      `${name} — ${failures.length ? failures.join('; ') : `widget '${widget.title}' checks out`}`,
    );
  };

  const evaluateArtifactAssertion = async (assertion, index) => {
    const name = assertionName(assertion, index);
    const missing = missingCapabilities(assertion.requires);
    if (missing.length)
      return record(
        index,
        'blocked',
        `${name} — ${missing.map((m) => m.detail).join('; ')}`,
      );
    const artifact = executor.artifact;
    if (!artifact)
      return record(index, 'fail', `${name} — no visual on screen`);
    const html = artifact.definition?.module?.html ?? '';
    if (assertion.kind !== undefined)
      return record(
        index,
        artifact.definition?.kind === assertion.kind ? 'pass' : 'fail',
        `${name} — artifact kind is '${artifact.definition?.kind ?? 'none'}'`,
      );
    if (assertion.min_visuals !== undefined) {
      const count =
        (html.match(/<img\b/gi) ?? []).length +
        (html.match(/<svg\b/gi) ?? []).length;
      return record(
        index,
        count >= assertion.min_visuals ? 'pass' : 'fail',
        `${name} — ${count} visuals, needed ${assertion.min_visuals}`,
      );
    }
    if (assertion.max_words !== undefined) {
      const words = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean).length;
      return record(
        index,
        words <= assertion.max_words ? 'pass' : 'fail',
        `${name} — ${words} visible words, limit ${assertion.max_words}`,
      );
    }
    if (assertion.judge) {
      const { value: rubric, unresolved } = interpolate(assertion.judge, ctx);
      if (unresolved.length)
        return record(
          index,
          'blocked',
          `${name} — unresolved ${unresolved.join(', ')}`,
        );
      const verdict = await judge(rubric, { page_html: html });
      return record(
        index,
        verdict.pass ? 'pass' : 'fail',
        `${name} — ${verdict.reason}`,
      );
    }
    return record(index, 'fail', `${name} — unknown assertion shape`);
  };

  console.log(
    `\n=== ${scenario.id} — ${scenario.title} (owner ${owner}) ===`,
  );

  let session = null;
  for (const [index, step] of scenario.steps.entries()) {
    const missing = missingCapabilities(step.requires);
    if (missing.length) {
      record(
        index,
        'blocked',
        `${describeStep(step)} — ${missing.map((m) => m.detail).join('; ')}`,
      );
      continue;
    }
    try {
      // `note` is an annotation — it never replaces the step's real work.
      if (step.note !== undefined)
        record(index, 'note', interpolate(String(step.note), ctx).value);
      if (step.say !== undefined) {
        const { value: text } = interpolate(String(step.say), ctx);
        if (!session) {
          session = await RealtimeSession.connect({ executor, log });
          // Same context the client injects when the data channel opens.
          const visible = (await board.list()).widgets
            .filter((w) => !w.archived)
            .map((w) => ({
              id: w.id,
              title: w.title,
              kind: w.definition.kind,
            }));
          session.sendSystemContext(
            `Current visible widgets: ${JSON.stringify(visible)}; focused widget: ${executor.focused}`,
          );
        }
        const turn = await session.say(text);
        ctx.lastSay = text;
        ctx.lastTurn = turn;
        ctx.turns.push({
          say: text,
          replies: turn.replies,
          calls: turn.calls.map((c) => ({
            name: c.name,
            arguments: c.arguments,
            output: c.output,
          })),
          ...(turn.error ? { error: turn.error } : {}),
        });
        const summary = turn.error
          ? `error: ${turn.error}`
          : `"${turn.replies.join(' ')}"${turn.calls.length ? ` (+${turn.calls.length} tool call${turn.calls.length > 1 ? 's' : ''})` : ''}`;
        record(index, turn.error ? 'fail' : 'pass', `say → ${summary}`);
      } else if (step.expect) {
        for (const [i, assertion] of step.expect.entries())
          await evaluateAssertion(assertion, index);
      } else if (step.expect_state) {
        const widgets = (await board.list()).widgets;
        for (const [i, assertion] of step.expect_state.entries())
          await evaluateStateAssertion(assertion, index, widgets);
      } else if (step.expect_artifact) {
        for (const assertion of step.expect_artifact)
          await evaluateArtifactAssertion(assertion, index);
      } else if (step.action) {
        const action = actions[step.action];
        if (!action)
          record(index, 'fail', `action ${step.action} — unknown action`);
        else {
          const outcome = await action(ctx);
          if (outcome?.facts) Object.assign(ctx.facts, outcome.facts);
          record(
            index,
            'pass',
            `action ${step.action} — ${outcome?.detail ?? 'done'}`,
          );
        }
      } else if (step.human) {
        if (!ctx.askHuman) {
          record(index, 'skipped', 'human step — non-interactive run');
          continue;
        }
        const { value: instructions } = interpolate(String(step.human), ctx);
        const answer = await ctx.askHuman(instructions);
        record(
          index,
          answer === 'done' ? 'pass' : answer,
          `human — ${answer}`,
        );
      } else if (step.run) {
        await new Promise((resolve, reject) => {
          const child = spawn(step.run, {
            shell: true,
            env: {
              ...process.env,
              EVAL_OWNER: owner,
              HOMEBOARD_BASE_URL: board.base,
            },
          });
          let text = '';
          child.stdout.on('data', (c) => (text += c));
          child.stderr.on('data', (c) => (text += c));
          child.on('error', reject);
          child.on('close', (code) =>
            code === 0
              ? resolve()
              : reject(Error(text.trim().split('\n').pop() ?? `exit ${code}`)),
          );
        });
        record(index, 'pass', `run — ${step.run}`);
      }
    } catch (error) {
      record(
        index,
        'fail',
        `${describeStep(step)} — ${error instanceof Error ? error.message : error}`,
      );
      if (step.fatal) break;
    }
  }

  session?.close();

  const counts = { pass: 0, fail: 0, blocked: 0, skipped: 0, note: 0 };
  for (const result of ctx.results)
    counts[result.status] = (counts[result.status] ?? 0) + 1;

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = new URL(
    `${startedAt.toISOString().replace(/[:.]/g, '-')}-${scenario.id}.json`,
    RESULTS_DIR,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        scenario: scenario.id,
        title: scenario.title,
        owner,
        startedAt: startedAt.toISOString(),
        facts: ctx.facts,
        counts,
        results: ctx.results.map((r, i) => ({
          step: scenario.steps[r.index],
          ...r,
        })),
        turns: ctx.turns,
        events: session?.events ?? [],
      },
      null,
      2,
    ),
  );
  console.log(
    `\n  ${counts.pass} pass · ${counts.fail} fail · ${counts.blocked} blocked · ${counts.skipped} skipped`,
  );
  console.log(`  transcript → ${file.pathname}`);
  return { scenario: scenario.id, counts, file: file.pathname };
}
