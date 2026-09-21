import assert from 'node:assert/strict';
import './prepare-widget-api-test.mjs';
const { GET, POST } = await import('../.wrangler/widget-api-tests/route.mjs');
const base = process.env.HOMEBOARD_TEST_URL || 'http://localhost:5178';
const owner = `widget-test-${crypto.randomUUID()}`;
const headers = {
  'Content-Type': 'application/json',
  'oai-authenticated-user-id': owner,
};
async function call(input, expected = 200, extra = {}) {
  const request = new Request(
    `${base}/api/widgets`,
    input
      ? {
          method: 'POST',
          headers: { ...headers, ...extra },
          body: JSON.stringify(input),
        }
      : { headers: { ...headers, ...extra } },
  );
  const r = await (input ? POST : GET)(request);
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text };
  }
  assert.equal(r.status, expected, JSON.stringify(body));
  return body;
}
async function act(widget, action, extra = {}) {
  return (
    await call({
      id: widget.id,
      revision: widget.revision,
      mutationId: crypto.randomUUID(),
      action,
      ...extra,
    })
  ).widget;
}
const first = await call();
assert.equal(first.widgets.length, 5);
assert.equal((await call()).widgets.length, 5);
let shopping = first.widgets.find((w) => w.definition.kind === 'shopping');
const mutation = {
  id: shopping.id,
  revision: shopping.revision,
  mutationId: crypto.randomUUID(),
  action: 'add_items',
  items: ['Milk', 'Bananas', 'Milk'],
};
shopping = (await call(mutation)).widget;
assert.equal(shopping.snapshot.data.items.length, 2);
assert.equal((await call(mutation)).widget.revision, shopping.revision);
await call({ ...mutation, mutationId: crypto.randomUUID() }, 409);
shopping = await act(shopping, 'toggle_checked', {
  item: shopping.snapshot.data.items[0].id,
});
shopping = await act(shopping, 'toggle_checked', {
  item: shopping.snapshot.data.items[1].id,
});
assert.equal(shopping.state.checked.length, 2);
const recipe = {
  title: 'Local verification recipe',
  sourceName: 'Verification fixture',
  canonicalUrl: 'https://example.com/homeboard-test-recipe',
  ingredients: ['One onion', 'One cup rice'],
  steps: ['Chop the onion.', 'Add the rice.', 'Serve.'],
  servings: '2',
};
let cooking = (
  await call({ action: 'recipe', recipeUrl: recipe.canonicalUrl, recipe })
).widget;
cooking = await act(cooking, 'step', { direction: 'next' });
const progress = cooking.state.stepId;
cooking = await act(cooking, 'keep');
assert.equal(cooking.pinned, true);
const positions = JSON.stringify(cooking.layouts),
  definition = cooking.definitionId;
const reloaded = (await call()).widgets.find((w) => w.id === cooking.id);
assert.equal(reloaded.state.stepId, progress);
assert.equal(JSON.stringify(reloaded.layouts), positions);
cooking = await act(reloaded, 'refine', {
  instruction: 'Make the steps larger',
});
assert.notEqual(cooking.definitionId, definition);
assert.equal(cooking.state.stepId, progress);
cooking = await act(cooking, 'step', { direction: 'next' });
const laterProgress = cooking.state.stepId;
cooking = await act(cooking, 'undo');
assert.equal(cooking.definitionId, definition);
assert.equal(cooking.state.stepId, laterProgress);
cooking = await act(cooking, 'save_recipe');
assert.ok(
  (await call()).widgets
    .find((w) => w.definition.kind === 'library')
    .snapshot.data.recipes.some((r) => r.canonicalUrl === recipe.canonicalUrl),
);
await call(
  {
    id: cooking.id,
    revision: cooking.revision,
    mutationId: crypto.randomUUID(),
    action: 'size',
    size: 'small',
  },
  400,
);
const agenda = (await call()).widgets.find((w) => w.title === 'Everyone’s day');
cooking = await act(cooking, 'size', { size: 'wide' });
assert.deepEqual(
  (await call()).widgets.find((w) => w.id === agenda.id).layouts,
  agenda.layouts,
);
await call(
  {
    id: cooking.id,
    revision: cooking.revision,
    mutationId: crypto.randomUUID(),
    action: 'state',
    state: { custom: { bad: { nested: true } } },
  },
  400,
);
await call(
  {
    id: cooking.id,
    revision: cooking.revision,
    mutationId: crypto.randomUUID(),
    action: 'keep',
  },
  403,
  { Origin: 'https://unrelated.example' },
);
const otherOwner = {
  'oai-authenticated-user-id': `other-${crypto.randomUUID()}`,
};
await call(
  {
    id: cooking.id,
    revision: cooking.revision,
    mutationId: crypto.randomUUID(),
    action: 'keep',
  },
  404,
  otherOwner,
);
cooking = await act(cooking, 'remove');
assert.ok(!(await call()).widgets.some((w) => w.id === cooking.id));
cooking = await act(cooking, 'restore');
assert.ok((await call()).widgets.some((w) => w.id === cooking.id));
console.log(
  'Passed: initialisation, durable board, idempotency, concurrent-write rejection, shopping deduplication, checklist state, recipe progress, refinement/undo, stable placement, origin checks and owner isolation.',
);
