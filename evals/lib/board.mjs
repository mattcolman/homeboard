// Client for the Homeboard board API, acting as a specific owner. Mirrors the
// mutation contract in app/page.tsx (revision + mutationId + same-origin
// headers) so tool calls behave exactly like the real client.
import { env, requireEnv } from './env.mjs';

export class Board {
  constructor(baseUrl, owner) {
    this.base = baseUrl.replace(/\/$/, '');
    this.owner = owner;
  }

  #headers(mutating) {
    // x-homeboard-eval-owner is honored by ownerFor() only on a local dev
    // server; the oai-* header is what production uses (the dev middleware
    // strips it, so sending both is safe everywhere).
    const headers = {
      'oai-authenticated-user-id': this.owner,
      'x-homeboard-eval-owner': this.owner,
    };
    if (mutating) {
      headers['content-type'] = 'application/json';
      headers['origin'] = this.base;
    }
    return headers;
  }

  async list() {
    const response = await fetch(`${this.base}/api/widgets`, {
      headers: this.#headers(false),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error ?? `Board load failed (${response.status}).`);
    return data;
  }

  async post(body) {
    const response = await fetch(`${this.base}/api/widgets`, {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error ?? `Request failed (${response.status}).`);
    return data;
  }

  async widget(id) {
    const board = await this.list();
    return board.widgets.find((w) => w.id === id);
  }

  async resolve(query) {
    return this.post({ action: 'resolve', query });
  }

  // Mirrors the client's action() helper: fresh revision + mutationId.
  async act(id, action, args = {}) {
    const widget = await this.widget(id);
    if (!widget) throw Error('That widget is not on the board.');
    const data = await this.post({
      id,
      revision: widget.revision,
      mutationId: crypto.randomUUID(),
      action,
      ...args,
    });
    return data.widget;
  }

  async openRecipe(recipe) {
    const data = await this.post({
      action: 'recipe',
      recipeUrl: recipe.canonicalUrl,
      recipe,
    });
    return data.widget;
  }

  async findRecipes(query) {
    const response = await fetch(`${this.base}/api/recipes/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error ?? 'The recipes could not be loaded.');
    return data.recipes ?? [];
  }

  async savedRecipes(query) {
    const response = await fetch(
      `${this.base}/api/recipes?q=${encodeURIComponent(query)}`,
      { cache: 'no-store' },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error ?? 'The recipes could not be loaded.');
    return data.recipes ?? [];
  }

  async saveRecipe(recipe) {
    const response = await fetch(`${this.base}/api/recipes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(recipe),
    });
    if (!response.ok) throw Error('The recipe could not be saved.');
  }

  async #postArtifacts(body) {
    const response = await fetch(`${this.base}/api/artifacts`, {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error ?? `Request failed (${response.status}).`);
    return data;
  }

  async artifacts() {
    const response = await fetch(`${this.base}/api/artifacts`, {
      headers: this.#headers(false),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error ?? `Artifacts load failed (${response.status}).`);
    return data.artifacts ?? [];
  }

  async showVisual(query) {
    const data = await this.#postArtifacts({ action: 'create', query });
    return data.artifact;
  }

  async artifactAct(id, action, args = {}) {
    return this.#postArtifacts({ action, id, ...args });
  }

  async ingest(payload) {
    const response = await fetch(`${this.base}/api/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ingest-key': requireEnv('HOMEBOARD_INGEST_KEY'),
      },
      body: JSON.stringify({ owner: this.owner, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error ?? `Ingest failed (${response.status}).`);
    return data;
  }
}

export function boardFromEnv(owner) {
  return new Board(env('HOMEBOARD_BASE_URL', 'http://localhost:3000'), owner);
}
