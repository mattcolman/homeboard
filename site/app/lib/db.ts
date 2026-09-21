import { env } from 'cloudflare:workers';
import type { Recipe } from './recipes';

type RecipeRow = {
  id: number; canonical_url: string; title: string; source_name: string; source_author: string | null;
  image_url: string | null; video_url: string | null; description: string | null; total_minutes: number | null;
  servings: string | null; ingredients_json: string; steps_json: string; family_note: string | null; favourite: number;
};

const db = () => (env as unknown as { DB: D1Database }).DB;

export function rowToRecipe(row: RecipeRow): Recipe {
  return { id: row.id, canonicalUrl: row.canonical_url, title: row.title, sourceName: row.source_name,
    sourceAuthor: row.source_author ?? undefined, imageUrl: row.image_url ?? undefined, videoUrl: row.video_url ?? undefined,
    description: row.description ?? undefined, totalMinutes: row.total_minutes ?? undefined, servings: row.servings ?? undefined,
    ingredients: JSON.parse(row.ingredients_json), steps: JSON.parse(row.steps_json), familyNote: row.family_note ?? undefined,
    favourite: Boolean(row.favourite) };
}

export async function listRecipes(query = '') {
  const result = query
    ? await db().prepare('SELECT * FROM recipes WHERE title LIKE ? OR family_note LIKE ? ORDER BY created_at DESC LIMIT 20').bind(`%${query}%`, `%${query}%`).all<RecipeRow>()
    : await db().prepare('SELECT * FROM recipes ORDER BY created_at DESC LIMIT 20').all<RecipeRow>();
  return result.results.map(rowToRecipe);
}

export async function saveRecipe(recipe: Recipe) {
  await db().prepare(`INSERT INTO recipes (canonical_url,title,source_name,source_author,image_url,video_url,description,total_minutes,servings,ingredients_json,steps_json,family_note,favourite,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET title=excluded.title, source_name=excluded.source_name, source_author=excluded.source_author, image_url=excluded.image_url, video_url=excluded.video_url, description=excluded.description, total_minutes=excluded.total_minutes, servings=excluded.servings, ingredients_json=excluded.ingredients_json, steps_json=excluded.steps_json, family_note=COALESCE(excluded.family_note,recipes.family_note), favourite=1`)
    .bind(recipe.canonicalUrl, recipe.title, recipe.sourceName, recipe.sourceAuthor ?? null, recipe.imageUrl ?? null, recipe.videoUrl ?? null, recipe.description ?? null, recipe.totalMinutes ?? null, recipe.servings ?? null, JSON.stringify(recipe.ingredients), JSON.stringify(recipe.steps), recipe.familyNote ?? null, 1, new Date().toISOString()).run();
  const row = await db().prepare('SELECT * FROM recipes WHERE canonical_url = ?').bind(recipe.canonicalUrl).first<RecipeRow>();
  if (!row) throw new Error('Recipe was not saved.');
  return rowToRecipe(row);
}
