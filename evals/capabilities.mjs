// Capability registry. Steps and assertions can declare `requires: [...]`;
// anything requiring an unimplemented capability is reported "blocked" rather
// than "failed" — the eval doubles as a spec for features that don't exist yet.
//
// `tool:<name>` resolves automatically against the real SESSION_CONFIG, so
// blocked steps unblock themselves the day the tool ships.
import { SESSION_CONFIG } from '../app/api/realtime/session.ts';

// Harness-level abilities that exist as eval actions today even though the
// product itself lacks them.
const FEATURES = {
  'connector:golf.com.au': {
    implemented: true,
    notes:
      'evals/actions/golf-login.mjs + spike golf-sync (headed persistent-profile Chrome)',
  },
  'shopping:ingredient-curation': {
    implemented: true,
    notes:
      'add_items curates recipe-sourced items via curateForShopping() (app/lib/widgets/curate-shopping.ts): drops unbuyable lines, strips pantry quantities, groups by category',
  },
};

export function capabilityStatus(name) {
  if (name.startsWith('tool:')) {
    const tool = name.slice(5);
    const present = (SESSION_CONFIG.tools ?? []).some(
      (t) => t.name === tool,
    );
    return {
      implemented: present,
      detail: present
        ? `tool '${tool}' is live in the realtime session`
        : `tool '${tool}' is not in SESSION_CONFIG — product capability missing`,
    };
  }
  const feature = FEATURES[name];
  if (feature)
    return { implemented: feature.implemented, detail: feature.notes };
  return { implemented: false, detail: `unknown capability '${name}'` };
}

export function missingCapabilities(requires = []) {
  return requires
    .map((name) => ({ name, ...capabilityStatus(name) }))
    .filter((capability) => !capability.implemented);
}
