import { listRecipes, saveRecipe } from '@/app/lib/db';
import { isSafePublicRecipeUrl, type Recipe } from '@/app/lib/recipes';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.slice(0, 100) ?? '';
  return Response.json({ recipes: await listRecipes(query) });
}

export async function POST(request: Request) {
  const recipe = await request.json() as Recipe;
  if (!recipe?.title || !isSafePublicRecipeUrl(recipe.canonicalUrl) || !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.steps)) {
    return Response.json({ error: 'That recipe is incomplete or does not have a safe public source.' }, { status: 400 });
  }
  return Response.json({ recipe: await saveRecipe(recipe) });
}
