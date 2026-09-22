import type { CalendarEvent } from '../widgets/model';

export const HOME_TIME_ZONE = 'Australia/Sydney';
/** Fallback weather location when the request carries no Cloudflare geo. */
export const HOME_PLACE = {
  name: 'Sydney',
  latitude: -33.8688,
  longitude: 151.2093,
};
export type CalendarRange = 'today' | 'tomorrow' | 'upcoming';

export function localDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: HOME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(typeof value === 'string' ? new Date(value) : value)
    .filter((part) => part.type !== 'literal');
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function nextDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

export function calendarEventsForRange(
  events: CalendarEvent[],
  range: CalendarRange,
  now = new Date(),
) {
  const today = localDateKey(now);
  const tomorrow = nextDateKey(today);
  return {
    timeZone: HOME_TIME_ZONE,
    requestedRange: range,
    today,
    tomorrow,
    events: events
      .map((event) => {
        const localDate = localDateKey(event.startsAt);
        const dayRelation =
          localDate === today
            ? 'today'
            : localDate === tomorrow
              ? 'tomorrow'
              : 'upcoming';
        const dateLabel = new Intl.DateTimeFormat('en-AU', {
          timeZone: HOME_TIME_ZONE,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        }).format(new Date(event.startsAt));
        const localTime = event.allDay
          ? 'All day'
          : new Intl.DateTimeFormat('en-AU', {
              timeZone: HOME_TIME_ZONE,
              hour: 'numeric',
              minute: '2-digit',
            }).format(new Date(event.startsAt));
        return {
          title: event.title,
          localDate,
          dayRelation,
          localTime,
          when: event.allDay
            ? `All day ${dayRelation === 'upcoming' ? dateLabel : dayRelation}`
            : `${dayRelation === 'upcoming' ? dateLabel : dayRelation} at ${localTime}`,
          allDay: event.allDay,
          calendar: event.calendarName,
          location: event.location,
        };
      })
      .filter((event) => range === 'upcoming' || event.dayRelation === range),
  };
}
