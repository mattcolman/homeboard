import {
  actOnWidget,
  assertMutationOrigin,
  loadBoard,
  ownerFor,
  recipeWidget,
  resolveWidget,
  WidgetError,
} from '@/app/lib/widgets/store';
import { parseRecipeJson } from '@/app/lib/recipes';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  if (error instanceof WidgetError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers },
    );
  const message =
    error instanceof Error
      ? error.message
      : 'Homeboard could not load the board.';
  if (/D1_ERROR|SQLITE|no such table/i.test(message)) {
    console.error('Widget storage unavailable');
    return Response.json(
      {
        error:
          'Your board is temporarily unavailable. Please try again shortly.',
      },
      { status: 503, headers },
    );
  }
  return Response.json({ error: message }, { status: 502, headers });
}
export async function GET(request: Request) {
  try {
    return Response.json(await loadBoard(ownerFor(request), request), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const owner = ownerFor(request);
    assertMutationOrigin(request);
    const text = await request.text();
    if (text.length > 60000)
      throw new WidgetError('That request is too large.', 413);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(text);
    } catch {
      throw new WidgetError('That request could not be read.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new WidgetError('Invalid request.');
    if (input.action === 'resolve')
      return Response.json(
        await resolveWidget(
          owner,
          typeof input.query === 'string' ? input.query : '',
        ),
        { headers },
      );
    if (input.action === 'recipe') {
      const recipe = input.recipe
        ? parseRecipeJson({ recipes: [input.recipe] }, false)[0]
        : undefined;
      if (input.recipe && !recipe)
        throw new WidgetError(
          'That recipe needs a safe source and complete ingredients and steps.',
        );
      return Response.json(
        {
          widget: await recipeWidget(
            owner,
            typeof input.recipeUrl === 'string' ? input.recipeUrl : '',
            recipe,
          ),
        },
        { headers },
      );
    }
    if (typeof input.id !== 'string' || input.id.length > 150)
      throw new WidgetError('Choose a widget first.');
    return Response.json(
      { widget: await actOnWidget(owner, input.id, input) },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
