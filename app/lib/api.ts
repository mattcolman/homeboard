import { WidgetError } from './widgets/store';

export const NO_STORE = { 'Cache-Control': 'private, no-store' };
export function failure(error: unknown) {
  if (error instanceof WidgetError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: NO_STORE },
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
      { status: 503, headers: NO_STORE },
    );
  }
  return Response.json({ error: message }, { status: 502, headers: NO_STORE });
}
