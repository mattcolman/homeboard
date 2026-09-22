import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import ts from 'typescript';
await mkdir('.wrangler/widget-api-tests', { recursive: true });
// Parallel test files all run this prepare; write atomically so a reader
// never catches a half-written module.
const emit = async (name, source) => {
  const tmp = `.wrangler/widget-api-tests/${name}.${process.pid}.tmp`;
  await writeFile(tmp, source);
  await rename(tmp, `.wrangler/widget-api-tests/${name}`);
};
await emit(
  'runtime.mjs',
  await readFile('tests/widget-test-runtime.mjs', 'utf8'),
);
const files = {
  model: 'app/lib/widgets/model.ts',
  generation: 'app/lib/widgets/generation.ts',
  'curate-shopping': 'app/lib/widgets/curate-shopping.ts',
  store: 'app/lib/widgets/store.ts',
  calendar: 'app/lib/calendar/icloud.ts',
  local: 'app/lib/calendar/local.ts',
  weather: 'app/lib/weather.ts',
  recipes: 'app/lib/recipes.ts',
  db: 'app/lib/db.ts',
  'family-palette': 'app/lib/family-palette.ts',
  family: 'app/lib/family.ts',
  route: 'app/api/widgets/route.ts',
  ingest: 'app/api/ingest/route.ts',
  familyroute: 'app/api/family/route.ts',
};
for (const [name, file] of Object.entries(files)) {
  let source = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  for (const [from, to] of Object.entries({
    'cloudflare:workers': './runtime.mjs',
    '../db': './db.mjs',
    '../calendar/icloud': './calendar.mjs',
    '../widgets/model': './model.mjs',
    '../weather': './weather.mjs',
    './calendar/local': './local.mjs',
    './widgets/model': './model.mjs',
    '../recipes': './recipes.mjs',
    './recipes': './recipes.mjs',
    './generation': './generation.mjs',
    './curate-shopping': './curate-shopping.mjs',
    './family-palette': './family-palette.mjs',
    './widgets/store': './store.mjs',
    '../family': './family.mjs',
    './model': './model.mjs',
    '@/app/lib/widgets/store': './store.mjs',
    '@/app/lib/recipes': './recipes.mjs',
    '@/app/lib/family': './family.mjs',
  }))
    source = source.replaceAll(`'${from}'`, `'${to}'`);
  await emit(`${name}.mjs`, source);
}
