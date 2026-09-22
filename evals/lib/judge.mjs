// LLM judge for soft expectations ("did not hallucinate", "asked where to
// look"). Returns { pass, reason } — judges never see the rubric phrased as a
// hint; they grade a transcript slice against it strictly.
import { env, requireEnv } from './env.mjs';

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
};

function extractText(payload) {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('');
}

export async function judge(rubric, context) {
  const model = env('EVAL_JUDGE_MODEL', 'gpt-5-mini');
  const prompt = `You are grading one turn of a Homeboard scenario eval. Homeboard is a voice assistant on a family kitchen display whose replies are short spoken sentences backed by widget tool calls.

Evaluate the MOST RECENT assistant behaviour only — its spoken replies and tool calls — strictly against the rubric. A reply passes only if it satisfies the rubric as written. Do not give credit for intent or for earlier turns.

TRANSCRIPT (JSON):
${JSON.stringify(context, null, 2).slice(0, 14000)}

RUBRIC:
${rubric}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 800,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      text: {
        format: {
          type: 'json_schema',
          name: 'eval_verdict',
          strict: true,
          schema: VERDICT_SCHEMA,
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    return { pass: false, reason: `Judge request failed (${response.status}).` };
  try {
    const verdict = JSON.parse(extractText(payload));
    return { pass: verdict.verdict === 'pass', reason: verdict.reason ?? '' };
  } catch {
    return { pass: false, reason: 'The judge returned an unreadable verdict.' };
  }
}
