import {
  actOnWidget,
  assertMutationOrigin,
  createStickyNote,
  loadBoard,
  ownerFor,
  recipeWidget,
  resolveWidget,
  WidgetError,
} from '@/app/lib/widgets/store';
import { parseRecipeJson } from '@/app/lib/recipes';
import { failure, NO_STORE } from '@/app/lib/api';

export const dynamic = 'force-dynamic';
const headers = NO_STORE;
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
    if (input.action === 'sticky')
      return Response.json(
        { widget: await createStickyNote(owner, input.text) },
        { headers },
      );
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
