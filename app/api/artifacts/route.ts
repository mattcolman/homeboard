import {
  assertMutationOrigin,
  ownerFor,
  WidgetError,
} from '@/app/lib/widgets/store';
import {
  createArtifact,
  dismissArtifact,
  getArtifact,
  keepArtifactAsWidget,
  listArtifacts,
  refineArtifact,
  setArtifactState,
} from '@/app/lib/artifacts';
import { failure, NO_STORE } from '@/app/lib/api';

export const dynamic = 'force-dynamic';
const headers = NO_STORE;
export async function GET(request: Request) {
  try {
    const owner = ownerFor(request);
    const id = new URL(request.url).searchParams.get('id');
    return Response.json(
      id
        ? { artifact: await getArtifact(owner, id) }
        : { artifacts: await listArtifacts(owner) },
      { headers },
    );
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
    const id = typeof input.id === 'string' ? input.id : '';
    switch (input.action) {
      case 'create':
        return Response.json(
          {
            artifact: await createArtifact(
              owner,
              typeof input.query === 'string' ? input.query : '',
            ),
          },
          { headers },
        );
      case 'refine':
        return Response.json(
          {
            artifact: await refineArtifact(
              owner,
              id,
              typeof input.instruction === 'string' ? input.instruction : '',
            ),
          },
          { headers },
        );
      case 'state':
        return Response.json(
          { artifact: await setArtifactState(owner, id, input.state) },
          { headers },
        );
      case 'keep':
        return Response.json(await keepArtifactAsWidget(owner, id), {
          headers,
        });
      case 'dismiss':
        await dismissArtifact(owner, id);
        return Response.json({ dismissed: true }, { headers });
      default:
        throw new WidgetError('That action is not supported.');
    }
  } catch (error) {
    return failure(error);
  }
}
