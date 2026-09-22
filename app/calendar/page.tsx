'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import type {
  Board,
  CalendarEvent,
  FamilyMember,
} from '../lib/widgets/model';
import { SiteNav } from '../components/SiteNav';
import './calendar.css';

type View = 'agenda' | 'week' | 'month' | 'people';
const VIEWS: { id: View; label: string }[] = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'people', label: 'People' },
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const dayKey = (value: Date | string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const startOfWeek = (d: Date) => {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
};
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const timeLabel = (event: CalendarEvent) =>
  event.allDay
    ? 'All day'
    : new Intl.DateTimeFormat('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(event.startsAt));
const dayLabel = (key: string, today: string, tomorrow: string) => {
  if (key === today) return 'Today';
  if (key === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${key}T12:00:00`));
};

export default function CalendarPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('agenda');
  const [cursor, setCursor] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/widgets', { cache: 'no-store' });
      if (!r.ok) throw Error('The board could not be loaded.');
      setBoard((await r.json()) as Board);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'The board could not be loaded.',
      );
    }
  }, []);
  useEffect(() => {
    // The fetch resolves before it updates board state.
    // oxlint-disable-next-line react-compiler/react-compiler
    void load();
  }, [load]);

  const calendar = board?.widgets.find(
    (w) => w.definition.kind === 'calendar' && !w.archived,
  );
  const members = useMemo(() => board?.members ?? [], [board]);
  const byCalendar = useMemo(() => {
    const map = new Map<string, FamilyMember>();
    for (const member of members)
      for (const id of member.calendarIds) map.set(id, member);
    return map;
  }, [members]);
  const events = useMemo(
    () =>
      (calendar?.snapshot.data.calendarEvents ?? [])
        .slice()
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [calendar],
  );
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = dayKey(event.startsAt);
      const list = map.get(key);
      if (list) list.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [events]);
  const colorFor = (event: CalendarEvent) =>
    byCalendar.get(event.calendarId)?.color ?? event.calendarColor;
  const memberFor = (event: CalendarEvent) => byCalendar.get(event.calendarId);

  const refresh = async () => {
    if (!calendar || refreshing) return;
    setRefreshing(true);
    try {
      await fetch('/api/widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: calendar.id,
          revision: calendar.revision,
          mutationId: crypto.randomUUID(),
          action: 'refresh',
        }),
      });
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const today = dayKey(new Date());
  const tomorrow = dayKey(addDays(new Date(), 1));
  const periodLabel =
    view === 'week'
      ? `${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(startOfWeek(cursor))} – ${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' }).format(addDays(startOfWeek(cursor), 6))}`
      : view === 'month'
        ? new Intl.DateTimeFormat('en-AU', {
            month: 'long',
            year: 'numeric',
          }).format(cursor)
        : 'Next 45 days';
  const shift = (direction: -1 | 1) =>
    setCursor((c) =>
      view === 'week'
        ? addDays(c, direction * 7)
        : new Date(c.getFullYear(), c.getMonth() + direction, 1),
    );

  return (
    <main className="calendar-shell">
      <header className="calendar-header">
        <Link href="/" className="calendar-brand">
          <ArrowLeft />
          <span>
            <CalendarDays />
          </span>
          <div>
            Calendar<small>Everyone’s plans</small>
          </div>
        </Link>
        <SiteNav />
        <div className="calendar-controls">
          <div className="view-tabs" role="tablist">
            {VIEWS.map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                aria-selected={view === id}
                className={view === id ? 'is-active' : ''}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {(view === 'week' || view === 'month') && (
            <div className="period-nav">
              <button aria-label="Previous" onClick={() => shift(-1)}>
                <ChevronLeft />
              </button>
              <button className="period-today" onClick={() => setCursor(new Date())}>
                {periodLabel}
              </button>
              <button aria-label="Next" onClick={() => shift(1)}>
                <ChevronRight />
              </button>
            </div>
          )}
          {(view === 'agenda' || view === 'people') && (
            <span className="period-label">{periodLabel}</span>
          )}
          <button
            className="calendar-refresh"
            disabled={refreshing}
            onClick={() => void refresh()}
            aria-label="Refresh calendar"
          >
            <RefreshCw className={refreshing ? 'is-spinning' : ''} />
          </button>
        </div>
      </header>

      {error && <p className="calendar-notice">{error}</p>}
      {!board && !error && (
        <p className="calendar-notice">Loading the family calendar…</p>
      )}
      {board && !calendar?.snapshot.data.calendarConnected && (
        <div className="calendar-unconnected">
          <CalendarDays />
          <h1>No calendar connected yet.</h1>
          <p>
            Connect iCloud Calendar to see everyone’s plans here — the board
            only reads events, it never writes them.
          </p>
          <Link href="/connections">Connect iCloud Calendar</Link>
        </div>
      )}
      {board && calendar?.snapshot.data.calendarConnected && (
        <section className="calendar-body">
          {calendar.snapshot.data.calendarError && (
            <p className="calendar-notice">
              The last calendar update failed — showing the previous events.{' '}
              <Link href="/connections">Check connection</Link>
            </p>
          )}
          {view === 'agenda' && (
            <AgendaView
              events={events}
              memberFor={memberFor}
              colorFor={colorFor}
              today={today}
              tomorrow={tomorrow}
            />
          )}
          {view === 'week' && (
            <WeekView
              weekStart={startOfWeek(cursor)}
              eventsByDay={eventsByDay}
              memberFor={memberFor}
              colorFor={colorFor}
              today={today}
            />
          )}
          {view === 'month' && (
            <MonthView
              cursor={cursor}
              eventsByDay={eventsByDay}
              colorFor={colorFor}
              today={today}
            />
          )}
          {view === 'people' && (
            <PeopleView
              events={events}
              members={members}
              memberFor={memberFor}
              colorFor={colorFor}
              today={today}
              tomorrow={tomorrow}
            />
          )}
        </section>
      )}
    </main>
  );
}

function AgendaView({
  events,
  memberFor,
  colorFor,
  today,
  tomorrow,
}: {
  events: CalendarEvent[];
  memberFor: (e: CalendarEvent) => FamilyMember | undefined;
  colorFor: (e: CalendarEvent) => string;
  today: string;
  tomorrow: string;
}) {
  if (!events.length)
    return (
      <p className="calendar-notice">
        No upcoming events in the next 45 days.
      </p>
    );
  const days = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event.startsAt);
    const list = days.get(key);
    if (list) list.push(event);
    else days.set(key, [event]);
  }
  return (
    <div className="agenda-view">
      {[...days].map(([key, dayEvents]) => (
        <div key={key}>
          <h2 className="agenda-day">{dayLabel(key, today, tomorrow)}</h2>
          {dayEvents.map((event) => {
            const member = memberFor(event);
            return (
              <article className="agenda-event" key={event.id}>
                <time dateTime={event.startsAt}>{timeLabel(event)}</time>
                <i style={{ background: colorFor(event) }} />
                <div>
                  <strong>{event.title}</strong>
                  <small>
                    {member
                      ? `${member.emoji ? `${member.emoji} ` : ''}${member.name}`
                      : event.calendarName}
                    {event.location ? ` · ${event.location}` : ''}
                  </small>
                </div>
              </article>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function EventChip({
  event,
  color,
  label,
}: {
  event: CalendarEvent;
  color: string;
  label?: string;
}) {
  return (
    <div
      className="event-chip"
      title={`${timeLabel(event)} — ${event.title}`}
      style={{ borderLeftColor: color }}
    >
      {!event.allDay && <time>{timeLabel(event)}</time>}
      <span>{label ?? event.title}</span>
    </div>
  );
}

function WeekView({
  weekStart,
  eventsByDay,
  memberFor,
  colorFor,
  today,
}: {
  weekStart: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  memberFor: (e: CalendarEvent) => FamilyMember | undefined;
  colorFor: (e: CalendarEvent) => string;
  today: string;
}) {
  return (
    <div className="week-view">
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(weekStart, i),
          key = dayKey(day),
          dayEvents = eventsByDay.get(key) ?? [];
        return (
          <div
            key={key}
            className={`week-day ${key === today ? 'is-today' : ''}`}
          >
            <header>
              <span>{WEEKDAYS[i]}</span>
              <strong>{day.getDate()}</strong>
            </header>
            <div className="week-events">
              {dayEvents.map((event) => {
                const member = memberFor(event);
                return (
                  <EventChip
                    key={event.id}
                    event={event}
                    color={colorFor(event)}
                    label={
                      member
                        ? `${member.emoji ? `${member.emoji} ` : ''}${event.title}`
                        : undefined
                    }
                  />
                );
              })}
              {!dayEvents.length && <span className="week-empty" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({
  cursor,
  eventsByDay,
  colorFor,
  today,
}: {
  cursor: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  colorFor: (e: CalendarEvent) => string;
  today: string;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const lastInMonth = days.findLastIndex(
    (d) => d.getMonth() === cursor.getMonth(),
  );
  const visible = days.slice(0, Math.ceil((lastInMonth + 1) / 7) * 7);
  return (
    <div className="month-view">
      <div className="month-weekdays">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="month-grid">
        {visible.map((day) => {
          const key = dayKey(day),
            inMonth = day.getMonth() === cursor.getMonth(),
            dayEvents = eventsByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`month-day ${inMonth ? '' : 'is-outside'} ${key === today ? 'is-today' : ''}`}
            >
              <strong>{day.getDate()}</strong>
              {dayEvents.slice(0, 3).map((event) => (
                <EventChip
                  key={event.id}
                  event={event}
                  color={colorFor(event)}
                />
              ))}
              {dayEvents.length > 3 && (
                <span className="month-more">+{dayEvents.length - 3} more</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PeopleView({
  events,
  members,
  memberFor,
  colorFor,
  today,
  tomorrow,
}: {
  events: CalendarEvent[];
  members: FamilyMember[];
  memberFor: (e: CalendarEvent) => FamilyMember | undefined;
  colorFor: (e: CalendarEvent) => string;
  today: string;
  tomorrow: string;
}) {
  const columns = [
    ...members.map((member) => ({
      key: member.id,
      member,
      events: events.filter((e) => memberFor(e)?.id === member.id),
    })),
    {
      key: 'shared',
      member: undefined,
      events: events.filter((e) => !memberFor(e)),
    },
  ];
  if (!members.length)
    return (
      <p className="calendar-notice">
        Add the household on the{' '}
        <Link href="/family">Family page</Link> to see everyone’s column.
      </p>
    );
  return (
    <div className="people-view">
      {columns.map(({ key, member, events: columnEvents }) => {
        const days = new Map<string, CalendarEvent[]>();
        for (const event of columnEvents) {
          const day = dayKey(event.startsAt);
          const list = days.get(day);
          if (list) list.push(event);
          else days.set(day, [event]);
        }
        return (
          <div
            className="people-column"
            key={key}
            style={member ? { borderTopColor: member.color } : undefined}
          >
            <header>
              <span
                className="people-avatar"
                style={member ? { background: member.color } : undefined}
              >
                {member ? member.emoji || member.name.slice(0, 1) : '🏠'}
              </span>
              <strong>{member?.name ?? 'Everyone'}</strong>
            </header>
            {columnEvents.length ? (
              [...days].map(([day, dayEvents]) => (
                <div key={day}>
                  <h3>{dayLabel(day, today, tomorrow)}</h3>
                  {dayEvents.map((event) => (
                    <EventChip
                      key={event.id}
                      event={event}
                      color={colorFor(event)}
                    />
                  ))}
                </div>
              ))
            ) : member && !member.calendarIds.length ? (
              <p className="people-empty">
                Nothing linked yet — connect their calendars on the{' '}
                <Link href="/family">Family page</Link>.
              </p>
            ) : (
              <p className="people-empty">Nothing scheduled.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
