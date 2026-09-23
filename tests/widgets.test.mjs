import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

await mkdir('.wrangler/widget-tests', { recursive: true });
for (const file of ['model', 'generation']) {
  const source = await readFile(`app/lib/widgets/${file}.ts`, 'utf8');
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace("'./model'", "'./model.mjs'");
  await writeFile(`.wrangler/widget-tests/${file}.mjs`, compiled);
}
const {
  packWidgets,
  columnsForWidth,
  stepId,
  safeUrl,
  validateState,
  isExpired,
  relativeTime,
} = await import(
  pathToFileURL(`${process.cwd()}/.wrangler/widget-tests/model.mjs`)
);
const { validateGenerated, validatePage } = await import(
  pathToFileURL(`${process.cwd()}/.wrangler/widget-tests/generation.mjs`)
);
const widget = (id, size = 'standard', layouts = {}) => ({
  id,
  size,
  layouts,
  order: Number(id.replace(/\D/g, '')) || 0,
  pinned: false,
});
const generated = () => ({
  title: 'Comparison',
  summary: 'A useful comparison.',
  kind: 'composition',
  tone: 'cream',
  timeSensitive: false,
  module: { html: '', css: '', js: '' },
  blocks: [
    {
      id: 'options',
      type: 'comparison',
      text: '',
      label: '',
      value: '',
      items: [
        { label: 'A', value: 'One' },
        { label: 'B', value: 'Two' },
      ],
      children: [],
    },
  ],
});
test('reference widths choose 12, 8 and 4 columns', () => {
  assert.deepEqual([960, 1116, 704, 443].map(columnsForWidth), [12, 12, 8, 4]);
});
test('packing stays in bounds and never overlaps across all responsive sizes', () => {
  const widgets = Array.from({ length: 30 }, (_, i) =>
    widget(`w${i}`, ['standard', 'tall', 'wide', 'small', 'focus'][i % 5]),
  );
  for (const columns of [4, 8, 12]) {
    const positions = packWidgets(widgets, columns),
      occupied = new Set();
    assert.equal(positions.size, widgets.length);
    for (const p of positions.values()) {
      assert.ok(p.x + p.w <= columns);
      for (let y = p.y; y < p.y + p.h; y++)
        for (let x = p.x; x < p.x + p.w; x++) {
          const cell = `${x},${y}`;
          assert.ok(!occupied.has(cell));
          occupied.add(cell);
        }
    }
  }
});
test('a saved pinned slot is stable when another widget is added', () => {
  const pinned = {
    ...widget('w1', 'tall', { 12: { x: 8, y: 0, w: 4, h: 6 } }),
    pinned: true,
  };
  assert.deepEqual(
    packWidgets([widget('w0'), pinned, widget('w2', 'focus')], 12).get('w1'),
    pinned.layouts[12],
  );
});
test('state validation rejects nested capabilities and unsafe keys', () => {
  assert.throws(() => validateState({ custom: { key: { token: 'value' } } }));
  assert.throws(() =>
    validateState({ custom: JSON.parse('{"__proto__":"value"}') }),
  );
  assert.throws(() => validateState({ custom: { number: Infinity } }));
  assert.throws(() => validateState({ command: 'fetch' }));
  assert.deepEqual(validateState({ custom: { speed: 2, active: true } }), {
    custom: { speed: 2, active: true },
  });
});
test('recipe step identity is independent of its position', () => {
  const steps = ['Chop the onion.', 'Add the rice.'];
  assert.equal(stepId(steps[1]), stepId(['Warm the pan.', ...steps][2]));
});
test('generated layouts and content are stored separately', () => {
  const input = generated();
  const output = validateGenerated(input);
  assert.equal(output.definition.nodes[0].items, undefined);
  assert.equal(output.content.options.items[0].value, 'One');
});
test('malformed, duplicated and overly deep generated blocks fail closed', () => {
  const input = generated();
  input.blocks.push(input.blocks[0]);
  assert.throws(() => validateGenerated(input));
  const deep = generated();
  let block = deep.blocks[0];
  for (let i = 0; i < 6; i++) {
    const child = { ...block, id: `depth${i}`, children: [] };
    block.children = [child];
    block = child;
  }
  assert.throws(() => validateGenerated(deep));
});
test('custom modules cannot ask for external resources or known unsafe APIs', () => {
  const input = generated();
  input.kind = 'module';
  input.module.html = '<iframe src="https://example.com"></iframe>';
  assert.throws(() => validateGenerated(input));
  input.module.html = '<button>Explore</button>';
  input.module.js = 'fetch("https://example.com")';
  assert.throws(() => validateGenerated(input));
  input.module.js =
    'document.querySelector("button").addEventListener("click",()=>homeboard.setState({clicked:true}))';
  assert.equal(validateGenerated(input).definition.kind, 'module');
});
await test('pages allow https images but reject other external resources', () => {
  const page = () => ({
    title: 'How a plant grows',
    summary: 'A seed becomes a plant in stages.',
    tone: 'emerald',
    timeSensitive: false,
    html: '<figure><img src="https://upload.wikimedia.org/x.jpg" alt="seed" width="400" height="300"><figcaption>Seed</figcaption></figure>',
    css: 'figure{margin:0}',
    js: '',
  });
  const output = validatePage(page());
  assert.equal(output.definition.kind, 'page');
  assert.deepEqual(output.definition.nodes, [
    { id: 'summary', type: 'text', children: [] },
  ]);
  assert.equal(
    output.content.summary.text,
    'A seed becomes a plant in stages.',
  );
  const bad = (html) => assert.throws(() => validatePage({ ...page(), html }));
  bad('<img src="http://example.com/x.jpg">');
  bad(
    '<img src="https://example.com/x.jpg" srcset="https://example.com/x2.jpg 2x">',
  );
  bad('<a href="https://example.com">link</a>');
  bad('<script>alert(1)</script>');
  bad('<button onclick="go()">Go</button>');
  assert.throws(() =>
    validatePage({ ...page(), css: 'body{background:url(https://x)}' }),
  );
});
test('freshness and source URL boundaries are explicit', () => {
  assert.equal(isExpired({ expiresAt: '2020-01-01T00:00:00Z' }), true);
  assert.equal(isExpired({ expiresAt: null }), false);
  assert.equal(safeUrl('https://example.com/article'), true);
  for (const url of [
    'javascript:alert(1)',
    'https://127.0.0.1',
    'https://localhost',
    'https://user:secret@example.com',
  ])
    assert.equal(safeUrl(url), false);
});
await test('relative times are short, human labels', () => {
  const now = new Date('2026-02-20T12:00:00Z').getTime();
  assert.equal(relativeTime('2026-02-20T11:59:40Z', now), 'just now');
  assert.equal(relativeTime('2026-02-20T11:55:00Z', now), '5 min ago');
  assert.equal(relativeTime('2026-02-20T09:00:00Z', now), '3 h ago');
  assert.equal(relativeTime('2026-02-19T12:00:00Z', now), 'yesterday');
  assert.equal(relativeTime('2026-02-16T12:00:00Z', now), '4 days ago');
  assert.equal(
    relativeTime('2026-01-10T12:00:00Z', now),
    new Date('2026-01-10T12:00:00Z').toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
    }),
  );
  assert.equal(relativeTime('2026-03-01T00:00:00Z', now), 'just now');
  assert.equal(relativeTime('not-a-date', now), 'just now');
});
