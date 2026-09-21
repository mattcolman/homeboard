export const TRUSTED_RECIPE_DOMAINS = ['recipetineats.com', 'taste.com.au'] as const;

export type Recipe = {
  id?: number;
  title: string;
  sourceName: string;
  sourceAuthor?: string;
  canonicalUrl: string;
  imageUrl?: string;
  videoUrl?: string;
  description?: string;
  totalMinutes?: number;
  servings?: string;
  ingredients: string[];
  steps: string[];
  familyNote?: string;
  favourite?: boolean;
};

export function isTrustedRecipeUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return TRUSTED_RECIPE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function isSafePublicRecipeUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) return false;
    if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) return false;
    return true;
  } catch {
    return false;
  }
}

export function parseRecipeJson(value: unknown, trustedOnly = true): Recipe[] {
  if (!value || typeof value !== 'object' || !('recipes' in value) || !Array.isArray(value.recipes)) return [];
  return value.recipes.flatMap((item): Recipe[] => {
    if (!item || typeof item !== 'object') return [];
    const recipe = item as Record<string, unknown>;
    if (typeof recipe.title !== 'string' || typeof recipe.canonicalUrl !== 'string') return [];
    if (trustedOnly ? !isTrustedRecipeUrl(recipe.canonicalUrl) : !isSafePublicRecipeUrl(recipe.canonicalUrl)) return [];
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.filter((v): v is string => typeof v === 'string') : [];
    const steps = Array.isArray(recipe.steps) ? recipe.steps.filter((v): v is string => typeof v === 'string') : [];
    if (ingredients.length < 2 || steps.length < 2) return [];
    return [{
      title: recipe.title,
      sourceName: typeof recipe.sourceName === 'string' ? recipe.sourceName : new URL(recipe.canonicalUrl).hostname,
      sourceAuthor: typeof recipe.sourceAuthor === 'string' ? recipe.sourceAuthor : undefined,
      canonicalUrl: recipe.canonicalUrl,
      imageUrl: typeof recipe.imageUrl === 'string' ? recipe.imageUrl : undefined,
      videoUrl: typeof recipe.videoUrl === 'string' ? recipe.videoUrl : undefined,
      description: typeof recipe.description === 'string' ? recipe.description : undefined,
      totalMinutes: typeof recipe.totalMinutes === 'number' ? recipe.totalMinutes : undefined,
      servings: typeof recipe.servings === 'string' ? recipe.servings : undefined,
      ingredients,
      steps,
    }];
  }).slice(0, 3);
}
