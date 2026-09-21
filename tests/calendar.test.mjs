import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

await mkdir('.wrangler/calendar-tests', { recursive: true });
await copyFile(
  'tests/widget-test-runtime.mjs',
  '.wrangler/calendar-tests/runtime.mjs',
);
let source = ts.transpileModule(
  await readFile('app/lib/calendar/icloud.ts', 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
source = source
  .replaceAll("'cloudflare:workers'", "'./runtime.mjs'")
  .replaceAll("'../widgets/model'", "'./model.mjs'");
await writeFile('.wrangler/calendar-tests/icloud.mjs', source);
await writeFile('.wrangler/calendar-tests/model.mjs', 'export {};');
const localSource = ts
  .transpileModule(await readFile('app/lib/calendar/local.ts', 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  .outputText.replaceAll("'../widgets/model'", "'./model.mjs'");
await writeFile('.wrangler/calendar-tests/local.mjs', localSource);
process.env.CALENDAR_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString('base64');
const calendarModule = await import(
  `../.wrangler/calendar-tests/icloud.mjs?${Date.now()}`
);
const {
  calendarSnapshot,
  connectICloud,
  decryptCredential,
  encryptCredential,
  getCalendarConnectionStatus,
  parseIcsEvents,
  safeAppleUrl,
  startOfHomeDay,
} = calendarModule;
const { calendarEventsForRange } = await import(
  `../.wrangler/calendar-tests/local.mjs?${Date.now()}`
);

const calendar = {
  id: 'https://p01-caldav.icloud.com/123/calendars/home/',
  href: 'https://p01-caldav.icloud.com/123/calendars/home/',
  name: 'Family',
  color: '#315f50',
};
const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:daily-swim\r
DTSTART:20260922T060000Z\r
DTEND:20260922T070000Z\r
RRULE:FREQ=DAILY;COUNT=3\r
SUMMARY:Swimming\r
LOCATION:Pool\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:school-day\r
DTSTART;VALUE=DATE:20260923\r
DTEND;VALUE=DATE:20260924\r
SUMMARY:School holiday\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:annual-birthday\r
DTSTART;VALUE=DATE:19851004\r
DTEND;VALUE=DATE:19851005\r
RRULE:FREQ=YEARLY\r
SUMMARY:Birthday\r
END:VEVENT\r
END:VCALENDAR`;

test('calendar credentials round-trip through authenticated encryption', async () => {
  const encrypted = await encryptCredential('abcd-efgh-ijkl-mnop');
  assert.notEqual(encrypted, 'abcd-efgh-ijkl-mnop');
  assert.equal(await decryptCredential(encrypted), 'abcd-efgh-ijkl-mnop');
  await assert.rejects(() => decryptCredential(`${encrypted.slice(0, -2)}xx`));
});

test('calendar URLs allow Apple CalDAV shards and reject lookalikes', () => {
  assert.equal(
    safeAppleUrl(
      'https://p01-caldav.icloud.com/123/calendars/',
      'https://caldav.icloud.com/.well-known/caldav',
    ),
    'https://p01-caldav.icloud.com/123/calendars/',
  );
  assert.throws(() =>
    safeAppleUrl(
      'https://caldav.icloud.com.evil.example/123/',
      'https://caldav.icloud.com/.well-known/caldav',
    ),
  );
  assert.throws(() =>
    safeAppleUrl(
      'https://photos.icloud.com/123/',
      'https://caldav.icloud.com/.well-known/caldav',
    ),
  );
});

test('ICS parsing expands recurring and all-day events', () => {
  const events = parseIcsEvents(
    ics,
    calendar,
    new Date('2026-09-21T00:00:00Z'),
    new Date('2026-10-10T00:00:00Z'),
  );
  assert.deepEqual(
    events
      .filter((event) => event.title === 'Swimming')
      .map((event) => event.startsAt),
    [
      '2026-09-22T06:00:00.000Z',
      '2026-09-23T06:00:00.000Z',
      '2026-09-24T06:00:00.000Z',
    ],
  );
  assert.equal(
    events.find((event) => event.title === 'School holiday').allDay,
    true,
  );
  assert.equal(events[0].calendarName, 'Family');
  const birthday = events.find((event) => event.title === 'Birthday');
  assert.equal(birthday.startsAt, '2026-10-04T00:00:00.000Z');
  assert.equal(birthday.allDay, true);
});

test('the Homeboard day starts at Sydney midnight', () => {
  assert.equal(
    startOfHomeDay(new Date('2026-09-21T05:30:00Z')).toISOString(),
    '2026-09-20T14:00:00.000Z',
  );
  assert.equal(
    startOfHomeDay(new Date('2026-10-05T05:30:00Z')).toISOString(),
    '2026-10-04T13:00:00.000Z',
  );
});

test('voice calendar ranges use Sydney dates instead of UTC dates', () => {
  const events = [
    {
      id: 'today',
      calendarId: 'family',
      calendarName: 'Family',
      calendarColor: '#315f50',
      title: 'Maths tutoring',
      startsAt: '2026-09-21T05:45:00.000Z',
      endsAt: '2026-09-21T06:45:00.000Z',
      allDay: false,
      location: null,
    },
    {
      id: 'tomorrow',
      calendarId: 'family',
      calendarName: 'Family',
      calendarColor: '#315f50',
      title: 'School band',
      startsAt: '2026-09-21T22:00:00.000Z',
      endsAt: '2026-09-21T23:00:00.000Z',
      allDay: false,
      location: null,
    },
  ];
  const now = new Date('2026-09-21T05:30:00.000Z');
  const today = calendarEventsForRange(events, 'today', now);
  assert.equal(today.today, '2026-09-21');
  assert.deepEqual(
    today.events.map((event) => event.title),
    ['Maths tutoring'],
  );
  const tomorrow = calendarEventsForRange(events, 'tomorrow', now);
  assert.deepEqual(
    tomorrow.events.map((event) => event.title),
    ['School band'],
  );
  assert.equal(tomorrow.events[0].localDate, '2026-09-22');
  assert.equal(tomorrow.events[0].localTime, '8:00 am');
});

test('connection discovery, sync and cached snapshot share one contract', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/.well-known/caldav</d:href><d:propstat><d:prop><d:current-user-principal><d:href>https://p01-caldav.icloud.com/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`,
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`,
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:displayname>Family</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response></d:multistatus>`,
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/event.ics</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${ics}]]></c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`,
  ];
  let call = 0;
  globalThis.fetch = async (url, options) => {
    const requestedUrl =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    assert.match(requestedUrl, /^https:\/\/(?:p\d+-)?caldav\.icloud\.com\//);
    assert.match(options.headers.Authorization, /^Basic /);
    return new Response(responses[call++], {
      status: 207,
      headers: { 'Content-Type': 'application/xml' },
    });
  };
  try {
    const status = await connectICloud(
      'calendar-test-owner',
      'family@icloud.com',
      'abcd-efgh-ijkl-mnop',
    );
    assert.equal(status.connected, true);
    assert.equal(status.calendars[0].name, 'Family');
    const stored = await getCalendarConnectionStatus('calendar-test-owner');
    assert.equal(stored.lastError, null);
    const snapshot = await calendarSnapshot('calendar-test-owner');
    assert.equal(snapshot.data.calendarConnected, true);
    assert.ok(snapshot.data.calendarEvents.length >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
