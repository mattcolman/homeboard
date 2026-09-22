import { applyIngest, hash, ownerFor, WidgetError } from '@/app/lib/widgets/store';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  if (error instanceof WidgetError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers },
    );
  console.error('Ingest failed', error);
  return Response.json(
    { error: 'Homeboard could not accept that update.' },
    { status: 502, headers },
  );
}
/**
 * Push endpoint for external producers (home agents, scripts, connectors).
 * Authenticated by a shared secret rather than a browser session, so the
 * target owner is supplied explicitly. Writes snapshot.data.content on
 * widgets bound to `{ type: 'ingest', source }`, creating a card on first push.
 */
export async function POST(request: Request) {
  try {
    const expected = process.env.HOMEBOARD_INGEST_KEY;
    if (!expected)
      throw new WidgetError('Ingest is not configured on this Homeboard.', 503);
    const provided = request.headers.get('x-ingest-key') ?? '';
    const [given, wanted] = await Promise.all([hash(provided), hash(expected)]);
    if (given !== wanted)
      throw new WidgetError('That ingest key is not recognised.', 401);
    const text = await request.text();
    if (text.length > 20_000)
      throw new WidgetError('That request is too large.', 413);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(text);
    } catch {
      throw new WidgetError('That request could not be read.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new WidgetError('Invalid request.');
    let owner: string;
    if (typeof input.owner === 'string' && input.owner.length <= 150)
      owner = input.owner;
    else owner = ownerFor(request);
    const widgets = await applyIngest(owner, {
      source: typeof input.source === 'string' ? input.source : '',
      title: typeof input.title === 'string' ? input.title : undefined,
      nodes: Array.isArray(input.nodes)
        ? (input.nodes as { id: string; type: string }[])
        : undefined,
      content: input.content as Parameters<typeof applyIngest>[1]['content'],
      staleHours:
        typeof input.staleHours === 'number' ? input.staleHours : undefined,
    });
    return Response.json(
      { widgets: widgets.map((w) => ({ id: w.id, title: w.title })) },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
