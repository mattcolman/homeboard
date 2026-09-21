import {
  CalendarConnectionError,
  connectICloud,
  disconnectICloud,
  getCalendarConnectionStatus,
  selectCalendars,
  syncICloud,
} from '@/app/lib/calendar/icloud';
import {
  assertMutationOrigin,
  ownerFor,
  WidgetError,
} from '@/app/lib/widgets/store';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function failure(error: unknown) {
  if (error instanceof CalendarConnectionError || error instanceof WidgetError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers },
    );
  console.error('iCloud connection failed', error);
  return Response.json(
    { error: 'iCloud Calendar could not be updated. Please try again.' },
    { status: 502, headers },
  );
}
export async function GET(request: Request) {
  try {
    return Response.json(await getCalendarConnectionStatus(ownerFor(request)), {
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
    if (text.length > 12_000)
      throw new CalendarConnectionError('That request is too large.', 413);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(text);
    } catch {
      throw new CalendarConnectionError('That request could not be read.');
    }
    switch (input.action) {
      case 'connect':
        return Response.json(
          await connectICloud(
            owner,
            typeof input.email === 'string' ? input.email : '',
            typeof input.password === 'string' ? input.password : '',
          ),
          { headers },
        );
      case 'select':
        if (
          !Array.isArray(input.calendarIds) ||
          input.calendarIds.length > 50 ||
          input.calendarIds.some(
            (id) => typeof id !== 'string' || id.length > 2_048,
          )
        )
          throw new CalendarConnectionError('Choose valid calendars.');
        return Response.json(
          await selectCalendars(owner, input.calendarIds as string[]),
          { headers },
        );
      case 'sync':
        await syncICloud(owner);
        return Response.json(await getCalendarConnectionStatus(owner), {
          headers,
        });
      case 'disconnect':
        await disconnectICloud(owner);
        return Response.json(await getCalendarConnectionStatus(owner), {
          headers,
        });
      default:
        throw new CalendarConnectionError('Choose a calendar action.');
    }
  } catch (error) {
    return failure(error);
  }
}
