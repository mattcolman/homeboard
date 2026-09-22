// Eval runner CLI.
//   node run.mjs <scenario-id> [more ids|all] [--owner <id>] [--with-browser]
//                                    [--verbose] [--non-interactive]
import { readdirSync } from 'node:fs';
import { runScenario } from './lib/runner.mjs';

const args = process.argv.slice(2);
const flags = new Set();
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--owner') {
    flags.add('--owner');
    i++;
    continue;
  }
  if (args[i].startsWith('--')) flags.add(args[i]);
  else positional.push(args[i]);
}
const ownerFlag = flags.has('--owner')
  ? args[args.indexOf('--owner') + 1]
  : undefined;

const SCENARIOS_DIR = new URL('./scenarios/', import.meta.url);
const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.mjs'));
const wanted = positional.length
  ? positional
  : (console.log('Usage: node run.mjs <scenario-id|all> [--owner id] [--with-browser] [--verbose] [--non-interactive]'),
    console.log(`Available: ${files.map((f) => f.replace(/\.mjs$/, '')).join(', ')}`),
    process.exit(1));

const selected = wanted.includes('all')
  ? files
  : files.filter((f) => wanted.some((w) => f === `${w}.mjs` || f === w));
if (!selected.length) {
  console.error(`No matching scenario. Available: ${files.join(', ')}`);
  process.exit(1);
}

const summaries = [];
for (const file of selected) {
  const { default: scenario } = await import(new URL(file, SCENARIOS_DIR));
  if (scenario.browser && !flags.has('--with-browser')) {
    console.log(
      `\n=== ${scenario.id} — skipped (needs --with-browser; opens headed Chrome) ===`,
    );
    continue;
  }
  const summary = await runScenario(scenario, {
    owner: ownerFlag,
    verbose: flags.has('--verbose'),
    interactive: !flags.has('--non-interactive'),
  });
  summaries.push(summary);
}

const failed = summaries.reduce((n, s) => n + s.counts.fail, 0);
const blocked = summaries.reduce((n, s) => n + s.counts.blocked, 0);
if (summaries.length > 1) {
  console.log('\n==== summary ====');
  for (const s of summaries)
    console.log(
      `  ${s.scenario}: ${s.counts.pass} pass · ${s.counts.fail} fail · ${s.counts.blocked} blocked`,
    );
}
if (blocked)
  console.log(
    `\n${blocked} step${blocked > 1 ? 's' : ''} blocked on unbuilt capabilities — spec, not failure.`,
  );
process.exit(failed ? 1 : 0);
