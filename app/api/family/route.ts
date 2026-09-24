import {
  assertMutationOrigin,
  ownerFor,
  WidgetError,
} from '@/app/lib/widgets/store';
import {
  assignEventPeople,
  listEventPeople,
  listMembers,
  removeMember,
  saveMember,
} from '@/app/lib/family';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  if (error instanceof WidgetError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers },
    );
  return Response.json(
    { error: 'Your family list could not be updated.' },
    { status: 502, headers },
  );
}

export async function GET(request: Request) {
  try {
    const owner = ownerFor(request);
    return Response.json(
      {
        members: await listMembers(owner),
        eventPeople: await listEventPeople(owner),
      },
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
    const input = (await request.json()) as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new WidgetError('Invalid request.');
    const eventPeople =
      input.action === 'assign' ? await assignEventPeople(owner, input) : null;
    const members =
      input.action === 'save'
        ? await saveMember(owner, input)
        : input.action === 'remove'
          ? await removeMember(owner, input.id)
          : input.action === 'assign'
            ? await listMembers(owner)
            : (() => {
                throw new WidgetError('That action is not recognised.');
              })();
    return Response.json(
      { members, eventPeople: eventPeople ?? (await listEventPeople(owner)) },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
