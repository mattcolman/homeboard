import { env } from 'cloudflare:workers';
import ICAL from 'ical.js';
import type { CalendarEvent, Snapshot } from '../widgets/model';

const db = () => (env as unknown as { DB: D1Database }).DB;
const APPLE_CALDAV = 'https://caldav.icloud.com/.well-known/caldav';
const HOME_TIME_ZONE = 'Australia/Sydney';
const CALENDAR_PARSER_VERSION = 2;
const SYNC_WINDOW_DAYS = 45;
const MAX_EVENTS = 500;

export class CalendarConnectionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type CalendarChoice = {
  id: string;
  name: string;
  color: string;
  href: string;
};
type ConnectionRow = {
  owner_id: string;
  account_email: string;
  encrypted_secret: string;
  calendars_json: string;
  selected_calendar_ids_json: string;
  reminders_json: string;
  shopping_list_id: string | null;
  shopping_synced_at: string | null;
  shopping_error: string | null;
  status: string;
  parser_version: number;
  last_synced_at: string | null;
  last_error: string | null;
  updated_at: string;
};
export type CalendarConnectionStatus = {
  connected: boolean;
  accountEmail?: string;
  calendars: Omit<CalendarChoice, 'href'>[];
  selectedCalendarIds: string[];
  reminderLists: Omit<CalendarChoice, 'href'>[];
  shoppingListId: string | null;
  shoppingSyncedAt: string | null;
  shoppingError: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64 = (value: Uint8Array) => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
async function credentialKey() {
  const value = process.env.CALENDAR_CREDENTIAL_KEY;
  if (!value)
    throw new CalendarConnectionError(
      'Calendar credential protection is not configured.',
      503,
    );
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(value);
  } catch {
    throw new CalendarConnectionError(
      'Calendar credential protection is unavailable.',
      503,
    );
  }
  if (bytes.length !== 32)
    throw new CalendarConnectionError(
      'Calendar credential protection is unavailable.',
      503,
    );
  const raw = new Uint8Array(bytes).buffer;
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function encryptCredential(secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await credentialKey(),
    encoder.encode(secret),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}
export async function decryptCredential(value: string) {
  const [version, iv, encrypted] = value.split('.');
  if (version !== 'v1' || !iv || !encrypted)
    throw new CalendarConnectionError('Reconnect your iCloud calendar.', 409);
  try {
    return decoder.decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(iv) },
        await credentialKey(),
        fromBase64(encrypted),
      ),
    );
  } catch {
    throw new CalendarConnectionError('Reconnect your iCloud calendar.', 409);
  }
}

function xmlDecode(value: string) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
function firstTag(xml: string, name: string) {
  const match = xml.match(
    new RegExp(
      `<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`,
      'i',
    ),
  );
  return match ? xmlDecode(match[1].replace(/<[^>]+>/g, '').trim()) : '';
}
function tagBody(xml: string, name: string) {
  return (
    xml.match(
      new RegExp(
        `<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`,
        'i',
      ),
    )?.[1] ?? ''
  );
}
function responseBlocks(xml: string) {
  return (
    xml.match(
      /<(?:[\w-]+:)?response\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?response>/gi,
    ) ?? []
  );
}
export function safeAppleUrl(href: string, base: string) {
  if (href.length > 2_048)
    throw new CalendarConnectionError(
      'iCloud returned an unexpected calendar address.',
      502,
    );
  const url = new URL(href, base);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    (url.hostname !== 'caldav.icloud.com' &&
      !/^p\d+-caldav\.icloud\.com$/.test(url.hostname))
  )
    throw new CalendarConnectionError(
      'iCloud returned an unexpected calendar address.',
      502,
    );
  return url.toString();
}
function authHeader(email: string, password: string) {
  return `Basic ${toBase64(encoder.encode(`${email}:${password}`))}`;
}
async function dav(
  url: string,
  email: string,
  password: string,
  method: 'PROPFIND' | 'REPORT',
  depth: '0' | '1',
  body: string,
) {
  const response = await fetch(safeAppleUrl(url, APPLE_CALDAV), {
    method,
    signal: AbortSignal.timeout(25_000),
    headers: {
      Authorization: authHeader(email, password),
      Depth: depth,
      'Content-Type': 'application/xml; charset=utf-8',
      Accept: 'application/xml, text/xml',
    },
    body,
  });
  if (response.status === 401 || response.status === 403)
    throw new CalendarConnectionError(
      'iCloud rejected that email or app-specific password.',
      401,
    );
  if (!response.ok && response.status !== 207)
    throw new CalendarConnectionError(
      'iCloud Calendar could not be reached. Please try again.',
      502,
    );
  const text = await response.text();
  if (text.length > 8_000_000)
    throw new CalendarConnectionError(
      'That calendar is too large for Homeboard to sync safely.',
      413,
    );
  return { text, url: response.url || url };
}

const principalRequest = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const homeRequest = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
const calendarsRequest = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/></d:prop></d:propfind>`;

function safeColor(value: string) {
  return value.trim().match(/^#[\da-f]{6}/i)?.[0] ?? '#0430eb';
}

function componentNames(block: string) {
  return (
    tagBody(block, 'supported-calendar-component-set').match(
      /comp\b[^>]*\bname=["']([^"']+)["']/gi,
    ) ?? []
  ).map((name) =>
    name.replace(/.*\bname=["']([^"']+)["'].*/i, '$1').toUpperCase(),
  );
}

export async function discoverCollections(email: string, password: string) {
  email = email.trim();
  password = password.trim();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 12 ||
    password.length > 100
  )
    throw new CalendarConnectionError(
      'Enter your Apple Account email and app-specific password.',
    );
  const principal = await dav(
    APPLE_CALDAV,
    email,
    password,
    'PROPFIND',
    '0',
    principalRequest,
  );
  const principalHref = firstTag(
    tagBody(principal.text, 'current-user-principal'),
    'href',
  );
  if (!principalHref)
    throw new CalendarConnectionError(
      'iCloud did not return a calendar account.',
      502,
    );
  const principalUrl = safeAppleUrl(principalHref, principal.url);
  const home = await dav(
    principalUrl,
    email,
    password,
    'PROPFIND',
    '0',
    homeRequest,
  );
  const homeHref = firstTag(tagBody(home.text, 'calendar-home-set'), 'href');
  if (!homeHref)
    throw new CalendarConnectionError(
      'iCloud did not return a calendar home.',
      502,
    );
  const homeUrl = safeAppleUrl(homeHref, home.url);
  const listing = await dav(
    homeUrl,
    email,
    password,
    'PROPFIND',
    '1',
    calendarsRequest,
  );
  const collections = responseBlocks(listing.text)
    .filter((block) => /<(?:[\w-]+:)?calendar(?:\s|\/?\s*>)/i.test(block))
    .map((block, index): (CalendarChoice & { components: string[] }) | null => {
      const href = firstTag(block, 'href');
      if (!href) return null;
      const url = safeAppleUrl(href, listing.url);
      return {
        id: url,
        href: url,
        name:
          firstTag(block, 'displayname').slice(0, 120) ||
          `Calendar ${index + 1}`,
        color: safeColor(firstTag(block, 'calendar-color')),
        components: componentNames(block),
      };
    })
    .filter((calendar): calendar is CalendarChoice & { components: string[] } =>
      !!calendar,
    )
    .slice(0, 50);
  const calendars = collections
    .filter((item) => item.components.includes('VEVENT'))
    .map(({ components: _components, ...calendar }) => calendar);
  const reminderLists = collections
    .filter(
      (item) =>
        !item.components.includes('VEVENT') &&
        item.components.includes('VTODO'),
    )
    .map(({ components: _components, ...list }) => list);
  if (!calendars.length && !reminderLists.length)
    throw new CalendarConnectionError(
      'No calendars or reminder lists were found in that iCloud account.',
      404,
    );
  return { calendars, reminderLists };
}

function rangeValue(date: Date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function timeZoneOffset(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return (
    Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    ) - date.getTime()
  );
}

export function startOfHomeDay(date: Date) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: HOME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(date)
    .filter((part) => part.type !== 'literal');
  const value = Object.fromEntries(
    parts.map((part) => [part.type, Number(part.value)]),
  );
  const midnightAsUtc = Date.UTC(value.year, value.month - 1, value.day);
  let result = new Date(midnightAsUtc);
  result = new Date(midnightAsUtc - timeZoneOffset(result, HOME_TIME_ZONE));
  return new Date(midnightAsUtc - timeZoneOffset(result, HOME_TIME_ZONE));
}
function calendarQuery(start: Date, end: Date) {
  return `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${rangeValue(start)}" end="${rangeValue(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}
function calendarData(block: string) {
  const match = block.match(
    /<(?:[\w-]+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?calendar-data>/i,
  );
  return match
    ? xmlDecode(match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''))
    : '';
}
function eventId(calendarId: string, uid: string, startsAt: string) {
  const value = `${calendarId}\n${uid}\n${startsAt}`;
  let hash = 2166136261;
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `ical-${(hash >>> 0).toString(36)}`;
}

function occurrenceInstant(value: ICAL.Time) {
  return value.isDate
    ? new Date(Date.UTC(value.year, value.month - 1, value.day)).toISOString()
    : value.toJSDate().toISOString();
}

export function parseIcsEvents(
  ics: string,
  calendar: CalendarChoice,
  start: Date,
  end: Date,
  owner = '',
): (CalendarEvent & { externalUid: string; sourceUpdatedAt: string | null })[] {
  if (!ics.trim()) return [];
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const timezone of root.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(timezone);
    if (zone.tzid) ICAL.TimezoneService.register(zone);
  }
  const output: (CalendarEvent & {
    externalUid: string;
    sourceUpdatedAt: string | null;
  })[] = [];
  const components = root.getAllSubcomponents('vevent');
  const masters = new Map<string, ICAL.Event>();
  for (const component of components) {
    if (component.hasProperty('recurrence-id')) continue;
    const event = new ICAL.Event(component);
    if (!event.uid || component.getFirstPropertyValue('status') === 'CANCELLED')
      continue;
    masters.set(event.uid, event);
  }
  for (const component of components) {
    if (!component.hasProperty('recurrence-id')) continue;
    const exception = new ICAL.Event(component);
    if (exception.uid) masters.get(exception.uid)?.relateException(exception);
  }
  for (const event of masters.values()) {
    const add = (
      occurrence: ReturnType<ICAL.Event['getOccurrenceDetails']>,
    ) => {
      if (
        occurrence.item.component.getFirstPropertyValue('status') ===
        'CANCELLED'
      )
        return;
      const startsAt = occurrenceInstant(occurrence.startDate);
      const endsAt = occurrenceInstant(occurrence.endDate);
      if (new Date(endsAt) < start || new Date(startsAt) >= end) return;
      const item = occurrence.item;
      output.push({
        id: eventId(`${owner}\n${calendar.id}`, event.uid, startsAt),
        externalUid: event.uid,
        calendarId: calendar.id,
        calendarName: calendar.name,
        calendarColor: calendar.color,
        title: item.summary?.trim().slice(0, 300) || 'Untitled event',
        startsAt,
        endsAt,
        allDay: occurrence.startDate.isDate,
        location: item.location?.trim().slice(0, 300) || null,
        sourceUpdatedAt: (() => {
          const updated = item.component.getFirstPropertyValue('last-modified');
          return updated instanceof ICAL.Time
            ? updated.toJSDate().toISOString()
            : null;
        })(),
      });
    };
    if (!event.isRecurring()) {
      add({
        recurrenceId: event.startDate,
        item: event,
        startDate: event.startDate,
        endDate: event.endDate,
      });
      continue;
    }
    const iterator = event.iterator();
    for (let count = 0; count < 20_000; count++) {
      const occurrence = iterator.next();
      if (!occurrence || occurrence.toJSDate() >= end) break;
      add(event.getOccurrenceDetails(occurrence));
    }
  }
  return output;
}

async function connection(owner: string) {
  return db()
    .prepare('SELECT * FROM calendar_connections WHERE owner_id=?')
    .bind(owner)
    .first<ConnectionRow>();
}
function publicCalendars(calendars: CalendarChoice[]) {
  return calendars.map(({ id, name, color }) => ({ id, name, color }));
}
export async function getCalendarConnectionStatus(
  owner: string,
): Promise<CalendarConnectionStatus> {
  const row = await connection(owner);
  if (!row)
    return {
      connected: false,
      calendars: [],
      selectedCalendarIds: [],
      reminderLists: [],
      shoppingListId: null,
      shoppingSyncedAt: null,
      shoppingError: null,
      status: 'disconnected',
      lastSyncedAt: null,
      lastError: null,
    };
  const calendars = JSON.parse(row.calendars_json) as CalendarChoice[];
  const reminderLists = JSON.parse(row.reminders_json) as CalendarChoice[];
  return {
    connected: true,
    accountEmail: row.account_email,
    calendars: publicCalendars(calendars),
    selectedCalendarIds: JSON.parse(row.selected_calendar_ids_json),
    reminderLists: publicCalendars(reminderLists),
    shoppingListId: row.shopping_list_id,
    shoppingSyncedAt: row.shopping_synced_at,
    shoppingError: row.shopping_error,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
}

export async function connectICloud(
  owner: string,
  email: string,
  password: string,
) {
  const { calendars, reminderLists } = await discoverCollections(
    email,
    password,
  );
  const encrypted = await encryptCredential(password.trim());
  const shoppingList =
    reminderLists.find((list) => /shopping/i.test(list.name)) ?? null;
  const now = new Date().toISOString();
  await db()
    .prepare(
      `INSERT INTO calendar_connections(owner_id,provider,account_email,encrypted_secret,calendars_json,selected_calendar_ids_json,reminders_json,shopping_list_id,status,last_error,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?)
       ON CONFLICT(owner_id) DO UPDATE SET provider=excluded.provider,account_email=excluded.account_email,encrypted_secret=excluded.encrypted_secret,calendars_json=excluded.calendars_json,selected_calendar_ids_json=excluded.selected_calendar_ids_json,reminders_json=excluded.reminders_json,shopping_list_id=excluded.shopping_list_id,shopping_error=NULL,status=excluded.status,last_error=NULL,updated_at=excluded.updated_at`,
    )
    .bind(
      owner,
      'icloud',
      email.trim(),
      encrypted,
      JSON.stringify(calendars),
      JSON.stringify(calendars.map((calendar) => calendar.id)),
      JSON.stringify(reminderLists),
      shoppingList?.id ?? null,
      'connected',
      now,
      now,
    )
    .run();
  await syncICloud(owner);
  return getCalendarConnectionStatus(owner);
}

export async function selectCalendars(owner: string, selectedIds: string[]) {
  const row = await connection(owner);
  if (!row) throw new CalendarConnectionError('Connect iCloud first.', 404);
  const calendars = JSON.parse(row.calendars_json) as CalendarChoice[];
  const allowed = new Set(calendars.map((calendar) => calendar.id));
  const selected = [...new Set(selectedIds)].filter((id) => allowed.has(id));
  if (!selected.length)
    throw new CalendarConnectionError('Choose at least one calendar.');
  await db()
    .prepare(
      'UPDATE calendar_connections SET selected_calendar_ids_json=?,updated_at=? WHERE owner_id=?',
    )
    .bind(JSON.stringify(selected), new Date().toISOString(), owner)
    .run();
  await syncICloud(owner);
  return getCalendarConnectionStatus(owner);
}

export async function rediscoverCollections(owner: string) {
  const row = await connection(owner);
  if (!row) throw new CalendarConnectionError('Connect iCloud first.', 404);
  const password = await decryptCredential(row.encrypted_secret);
  const { calendars, reminderLists } = await discoverCollections(
    row.account_email,
    password,
  );
  const selected = new Set<string>(
    JSON.parse(row.selected_calendar_ids_json),
  );
  const keep = calendars
    .map((calendar) => calendar.id)
    .filter((id) => selected.has(id));
  const lists = new Set(reminderLists.map((list) => list.id));
  await db()
    .prepare(
      'UPDATE calendar_connections SET calendars_json=?,selected_calendar_ids_json=?,reminders_json=?,shopping_list_id=?,updated_at=? WHERE owner_id=?',
    )
    .bind(
      JSON.stringify(calendars),
      JSON.stringify(
        keep.length ? keep : calendars.map((calendar) => calendar.id),
      ),
      JSON.stringify(reminderLists),
      row.shopping_list_id && lists.has(row.shopping_list_id)
        ? row.shopping_list_id
        : (reminderLists.find((list) => /shopping/i.test(list.name))?.id ??
          null),
      new Date().toISOString(),
      owner,
    )
    .run();
  return getCalendarConnectionStatus(owner);
}

export async function selectShoppingList(owner: string, listId: string | null) {
  const row = await connection(owner);
  if (!row) throw new CalendarConnectionError('Connect iCloud first.', 404);
  if (listId !== null) {
    const lists = JSON.parse(row.reminders_json) as CalendarChoice[];
    if (!lists.some((list) => list.id === listId))
      throw new CalendarConnectionError(
        'Choose one of your iCloud reminder lists.',
      );
  }
  await db()
    .prepare(
      'UPDATE calendar_connections SET shopping_list_id=?,updated_at=? WHERE owner_id=?',
    )
    .bind(listId, new Date().toISOString(), owner)
    .run();
  return getCalendarConnectionStatus(owner);
}

export async function syncICloud(owner: string) {
  const row = await connection(owner);
  if (!row) throw new CalendarConnectionError('Connect iCloud first.', 404);
  const calendars = JSON.parse(row.calendars_json) as CalendarChoice[];
  const selected = new Set<string>(JSON.parse(row.selected_calendar_ids_json));
  const password = await decryptCredential(row.encrypted_secret);
  const start = startOfHomeDay(new Date());
  const end = new Date(Date.now() + SYNC_WINDOW_DAYS * 86400_000);
  try {
    const events: (CalendarEvent & {
      externalUid: string;
      sourceUpdatedAt: string | null;
    })[] = [];
    for (const calendar of calendars.filter((item) => selected.has(item.id))) {
      const result = await dav(
        calendar.href,
        row.account_email,
        password,
        'REPORT',
        '1',
        calendarQuery(start, end),
      );
      for (const block of responseBlocks(result.text)) {
        const data = calendarData(block);
        if (data)
          events.push(...parseIcsEvents(data, calendar, start, end, owner));
        if (events.length > MAX_EVENTS)
          throw new CalendarConnectionError(
            'More than 500 upcoming events were returned. Choose fewer calendars.',
            413,
          );
      }
    }
    await db()
      .prepare('DELETE FROM calendar_events WHERE owner_id=?')
      .bind(owner)
      .run();
    for (let index = 0; index < events.length; index += 40) {
      await db().batch(
        events.slice(index, index + 40).map((event) =>
          db()
            .prepare(
              'INSERT OR REPLACE INTO calendar_events(id,owner_id,calendar_id,calendar_name,calendar_color,external_uid,title,starts_at,ends_at,all_day,location,source_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              event.id,
              owner,
              event.calendarId,
              event.calendarName,
              event.calendarColor,
              event.externalUid,
              event.title,
              event.startsAt,
              event.endsAt,
              Number(event.allDay),
              event.location ?? null,
              event.sourceUpdatedAt,
            ),
        ),
      );
    }
    const now = new Date().toISOString();
    await db()
      .prepare(
        "UPDATE calendar_connections SET status='connected',parser_version=?,last_synced_at=?,last_error=NULL,updated_at=? WHERE owner_id=?",
      )
      .bind(CALENDAR_PARSER_VERSION, now, now, owner)
      .run();
    return events.length;
  } catch (error) {
    const message =
      error instanceof CalendarConnectionError
        ? error.message
        : 'iCloud Calendar could not be refreshed.';
    await db()
      .prepare(
        "UPDATE calendar_connections SET status='attention',last_error=?,updated_at=? WHERE owner_id=?",
      )
      .bind(message, new Date().toISOString(), owner)
      .run();
    throw error;
  }
}

export async function disconnectICloud(owner: string) {
  await db().batch([
    db().prepare('DELETE FROM calendar_events WHERE owner_id=?').bind(owner),
    db()
      .prepare('DELETE FROM calendar_connections WHERE owner_id=?')
      .bind(owner),
  ]);
}

export async function calendarSnapshot(
  owner: string,
  refresh: 'never' | 'if-stale' | 'always' = 'never',
): Promise<Snapshot> {
  let row = await connection(owner);
  if (!row)
    return {
      data: { calendarEvents: [], calendarConnected: false },
      source: 'iCloud Calendar · not connected',
      sources: [],
      fetchedAt: new Date(0).toISOString(),
      staleAt: null,
      expiresAt: null,
    };
  const stale =
    row.parser_version < CALENDAR_PARSER_VERSION ||
    !row.last_synced_at ||
    Date.now() - new Date(row.last_synced_at).getTime() > 15 * 60_000;
  if (refresh === 'always' || (refresh === 'if-stale' && stale)) {
    try {
      await syncICloud(owner);
    } catch {
      // Keep the last successful cache visible with the connection error.
    }
    row = (await connection(owner))!;
  }
  const result = await db()
    .prepare(
      'SELECT id,calendar_id,calendar_name,calendar_color,title,starts_at,ends_at,all_day,location FROM calendar_events WHERE owner_id=? AND ends_at>? ORDER BY starts_at LIMIT 100',
    )
    .bind(owner, startOfHomeDay(new Date()).toISOString())
    .all<{
      id: string;
      calendar_id: string;
      calendar_name: string;
      calendar_color: string;
      title: string;
      starts_at: string;
      ends_at: string;
      all_day: number;
      location: string | null;
    }>();
  const fetchedAt =
    row.last_synced_at ?? row.updated_at ?? new Date().toISOString();
  return {
    data: {
      calendarConnected: true,
      calendarError: row.last_error,
      calendarEvents: result.results.map((event) => ({
        id: event.id,
        calendarId: event.calendar_id,
        calendarName: event.calendar_name,
        calendarColor: event.calendar_color,
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        allDay: !!event.all_day,
        location: event.location,
      })),
    },
    source: 'iCloud Calendar',
    sources: [],
    fetchedAt,
    staleAt: new Date(
      new Date(fetchedAt).getTime() + 15 * 60_000,
    ).toISOString(),
    expiresAt: null,
  };
}

// --- iCloud Reminders (VTODO) — two-way shopping list sync ---

export type RemoteReminder = {
  uid: string;
  href: string;
  etag: string;
  text: string;
  checked: boolean;
};
export type ShoppingSyncItem = {
  id: string;
  text: string;
  category?: string;
  uid?: string;
  href?: string;
  etag?: string;
  remoteChecked?: boolean;
};
export type ShoppingConnection = {
  listId: string;
  listName: string;
  email: string;
  password: string;
  syncedAt: string | null;
};

const reminderChildrenRequest = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`;

function reminderMultiget(hrefs: string[]) {
  const links = hrefs
    .map(
      (href) =>
        `<d:href>${href.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</d:href>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>${links}</c:calendar-multiget>`;
}

async function davObject(
  url: string,
  email: string,
  password: string,
  method: 'GET' | 'PUT' | 'DELETE',
  init: { body?: string; etag?: string; create?: boolean } = {},
) {
  const headers: Record<string, string> = {
    Authorization: authHeader(email, password),
  };
  if (init.body) headers['Content-Type'] = 'text/calendar; charset=utf-8';
  if (init.etag) headers['If-Match'] = init.etag;
  if (init.create) headers['If-None-Match'] = '*';
  const response = await fetch(safeAppleUrl(url, APPLE_CALDAV), {
    method,
    signal: AbortSignal.timeout(25_000),
    headers,
    ...(init.body ? { body: init.body } : {}),
  });
  if (response.status === 401 || response.status === 403)
    throw new CalendarConnectionError(
      'iCloud rejected that email or app-specific password.',
      401,
    );
  if (response.status === 404)
    throw new CalendarConnectionError(
      'That reminder no longer exists in iCloud.',
      404,
    );
  if (!response.ok)
    throw new CalendarConnectionError(
      'iCloud Reminders could not be reached. Please try again.',
      502,
    );
  return {
    text: await response.text(),
    etag: response.headers.get('etag') ?? '',
  };
}

export function parseReminders(
  xml: string,
  base: string,
): RemoteReminder[] {
  const items: RemoteReminder[] = [];
  for (const block of responseBlocks(xml)) {
    const href = firstTag(block, 'href');
    const etag = firstTag(block, 'getetag');
    const data = calendarData(block);
    if (!href || !data) continue;
    let root: ICAL.Component;
    try {
      root = new ICAL.Component(ICAL.parse(data));
    } catch {
      continue;
    }
    for (const vtodo of root.getAllSubcomponents('vtodo')) {
      const uid = String(vtodo.getFirstPropertyValue('uid') ?? '');
      const text = String(vtodo.getFirstPropertyValue('summary') ?? '')
        .trim()
        .slice(0, 400);
      if (!uid || !text) continue;
      items.push({
        uid,
        href: safeAppleUrl(href, base),
        etag,
        text,
        checked:
          String(vtodo.getFirstPropertyValue('status') ?? '').toUpperCase() ===
          'COMPLETED',
      });
    }
  }
  return items;
}

async function fetchReminderItems(
  email: string,
  password: string,
  listHref: string,
): Promise<RemoteReminder[]> {
  // iCloud rejects calendar-query on VTODO collections, so list the child
  // resources first and then multiget their calendar data.
  const listing = await dav(
    listHref,
    email,
    password,
    'PROPFIND',
    '1',
    reminderChildrenRequest,
  );
  const children = responseBlocks(listing.text)
    .map((block) => firstTag(block, 'href'))
    .filter((href) => href.endsWith('.ics'))
    .slice(0, 200);
  if (!children.length) return [];
  const result = await dav(
    listHref,
    email,
    password,
    'REPORT',
    '1',
    reminderMultiget(children),
  );
  return parseReminders(result.text, result.url);
}

const icsEscape = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

async function createReminderItem(
  email: string,
  password: string,
  listHref: string,
  text: string,
  checked: boolean,
) {
  const uid = crypto.randomUUID();
  const stamp = rangeValue(new Date());
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Homeboard//Shopping//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${icsEscape(text)}`,
    checked ? 'STATUS:COMPLETED' : 'STATUS:NEEDS-ACTION',
    ...(checked ? [`COMPLETED:${stamp}`, 'PERCENT-COMPLETE:100'] : []),
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
  const base = listHref.endsWith('/') ? listHref : `${listHref}/`;
  const url = safeAppleUrl(`${uid}.ics`, base);
  const result = await davObject(url, email, password, 'PUT', {
    body: ics,
    create: true,
  });
  return { uid, href: url, etag: result.etag };
}

async function setReminderChecked(
  email: string,
  password: string,
  reminder: { href: string; etag: string },
  checked: boolean,
) {
  const current = await davObject(reminder.href, email, password, 'GET');
  const root = new ICAL.Component(ICAL.parse(current.text));
  const vtodo = root.getFirstSubcomponent('vtodo');
  if (!vtodo)
    throw new CalendarConnectionError(
      'iCloud returned an unreadable reminder.',
      502,
    );
  if (checked) {
    vtodo.updatePropertyWithValue('status', 'COMPLETED');
    vtodo.updatePropertyWithValue('percent-complete', 100);
    vtodo.updatePropertyWithValue(
      'completed',
      ICAL.Time.fromJSDate(new Date()),
    );
  } else {
    vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION');
    vtodo.updatePropertyWithValue('percent-complete', 0);
    vtodo.removeProperty('completed');
  }
  const result = await davObject(reminder.href, email, password, 'PUT', {
    body: root.toString(),
    etag: current.etag || reminder.etag || undefined,
  });
  return result.etag;
}

export async function shoppingConnection(
  owner: string,
): Promise<ShoppingConnection | null> {
  const row = await connection(owner);
  if (!row?.shopping_list_id) return null;
  const lists = JSON.parse(row.reminders_json) as CalendarChoice[];
  const list = lists.find((item) => item.id === row.shopping_list_id);
  if (!list) return null;
  return {
    listId: list.id,
    listName: list.name,
    email: row.account_email,
    password: await decryptCredential(row.encrypted_secret),
    syncedAt: row.shopping_synced_at,
  };
}

export async function deleteShoppingItem(
  owner: string,
  href: string,
  etag?: string,
) {
  const row = await connection(owner);
  if (!row?.shopping_list_id) return;
  const password = await decryptCredential(row.encrypted_secret);
  try {
    await davObject(href, row.account_email, password, 'DELETE', { etag });
  } catch (error) {
    if (
      error instanceof CalendarConnectionError &&
      error.status === 404
    )
      return;
    throw error;
  }
}

/**
 * Reconcile the shopping widget's items with the selected iCloud reminder
 * list. New local items are pushed, local check changes are pushed, remote
 * changes are pulled, and reminders deleted in iCloud disappear locally.
 * When both sides changed the same item, iCloud wins. Per-item push failures
 * leave that item unsynced so the next sync retries it; a list fetch failure
 * aborts the whole sync and records shopping_error.
 */
export async function syncShoppingItems(
  owner: string,
  items: ShoppingSyncItem[],
  checkedIds: string[],
): Promise<{ items: ShoppingSyncItem[]; checkedIds: string[] } | null> {
  const ctx = await shoppingConnection(owner);
  if (!ctx) return null;
  try {
    const remote = await fetchReminderItems(ctx.email, ctx.password, ctx.listId);
    const byUid = new Map(remote.map((item) => [item.uid, item]));
    const checked = new Set(checkedIds);
    const next: ShoppingSyncItem[] = [];
    const nextChecked = new Set<string>();
    for (const item of items) {
      if (!item.uid) {
        try {
          const done = checked.has(item.id);
          const created = await createReminderItem(
            ctx.email,
            ctx.password,
            ctx.listId,
            item.text,
            done,
          );
          next.push({ ...item, ...created, remoteChecked: done });
        } catch {
          next.push(item);
        }
        if (checked.has(item.id)) nextChecked.add(item.id);
        continue;
      }
      const reminder = byUid.get(item.uid);
      byUid.delete(item.uid);
      if (!reminder) continue;
      const localChecked = checked.has(item.id);
      const remoteChecked = item.remoteChecked ?? false;
      if (reminder.checked !== remoteChecked) {
        if (reminder.checked) nextChecked.add(item.id);
        next.push({
          ...item,
          text: reminder.text,
          href: reminder.href,
          etag: reminder.etag,
          remoteChecked: reminder.checked,
        });
      } else if (localChecked !== remoteChecked) {
        let etag = reminder.etag,
          synced = remoteChecked;
        try {
          etag =
            (await setReminderChecked(
              ctx.email,
              ctx.password,
              reminder,
              localChecked,
            )) || reminder.etag;
          synced = localChecked;
        } catch {
          // Leave remoteChecked stale so a later sync retries the push.
        }
        if (localChecked) nextChecked.add(item.id);
        next.push({ ...item, text: reminder.text, etag, remoteChecked: synced });
      } else {
        if (localChecked) nextChecked.add(item.id);
        next.push({ ...item, text: reminder.text, etag: reminder.etag });
      }
    }
    for (const reminder of byUid.values()) {
      const id = crypto.randomUUID();
      next.push({
        id,
        text: reminder.text,
        uid: reminder.uid,
        href: reminder.href,
        etag: reminder.etag,
        remoteChecked: reminder.checked,
      });
      if (reminder.checked) nextChecked.add(id);
    }
    const now = new Date().toISOString();
    await db()
      .prepare(
        'UPDATE calendar_connections SET shopping_synced_at=?,shopping_error=NULL,updated_at=? WHERE owner_id=?',
      )
      .bind(now, now, owner)
      .run();
    return { items: next, checkedIds: [...nextChecked] };
  } catch (error) {
    await db()
      .prepare(
        'UPDATE calendar_connections SET shopping_error=?,updated_at=? WHERE owner_id=?',
      )
      .bind(
        error instanceof CalendarConnectionError
          ? error.message
          : 'iCloud Reminders could not be refreshed.',
        new Date().toISOString(),
        owner,
      )
      .run();
    throw error;
  }
}
