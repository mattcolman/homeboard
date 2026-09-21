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
  syncShoppingItems,
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

test('reminder lists are discovered and shopping items sync both ways', async () => {
  const owner = 'reminder-test-owner';
  const listHref = 'https://p01-caldav.icloud.com/123/calendars/shopping/';
  const todo = (uid, summary, status) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nSTATUS:${status}\r\nEND:VTODO\r\nEND:VCALENDAR`;
  const store = new Map([
    ['egg-1', { href: `${listHref}eggs.ics`, ics: todo('egg-1', 'Eggs', 'NEEDS-ACTION') }],
    ['bread-1', { href: `${listHref}bread.ics`, ics: todo('bread-1', 'Bread', 'COMPLETED') }],
  ]);
  const remindersXml = () =>
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${[...store.values()]
      .map(
        (entry, index) =>
          `<d:response><d:href>${new URL(entry.href).pathname}</d:href><d:propstat><d:prop><d:getetag>t${index}</d:getetag><c:calendar-data><![CDATA[${entry.ics}]]></c:calendar-data></d:prop></d:propstat></d:response>`,
      )
      .join('')}</d:multistatus>`;
  const childrenXml = () =>
    `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/123/calendars/shopping/</d:href><d:propstat><d:prop><d:getetag>list</d:getetag></d:prop></d:propstat></d:response>${[...store.values()]
      .map(
        (entry) =>
          `<d:response><d:href>${new URL(entry.href).pathname}</d:href><d:propstat><d:prop><d:getetag>e</d:getetag></d:prop></d:propstat></d:response>`,
      )
      .join('')}</d:multistatus>`;
  const listing = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:displayname>Family</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response><d:response><d:href>/123/calendars/shopping/</d:href><d:propstat><d:prop><d:displayname>Shopping</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set><a:calendar-color>#34AADC</a:calendar-color></d:prop></d:propstat></d:response></d:multistatus>`;
  const eventsReport = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/event.ics</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${ics}]]></c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`;
  const puts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const requestedUrl =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    assert.match(requestedUrl, /^https:\/\/(?:p\d+-)?caldav\.icloud\.com\//);
    const method = options.method ?? 'GET';
    const body = typeof options.body === 'string' ? options.body : '';
    const xml = (payload) =>
      new Response(payload, {
        status: 207,
        headers: { 'Content-Type': 'application/xml' },
      });
    if (method === 'PROPFIND') {
      if (body.includes('current-user-principal'))
        return xml(
          `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/.well-known/caldav</d:href><d:propstat><d:prop><d:current-user-principal><d:href>https://p01-caldav.icloud.com/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`,
        );
      if (body.includes('calendar-home-set'))
        return xml(
          `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`,
        );
      if (requestedUrl === listHref) return xml(childrenXml());
      return xml(listing);
    }
    if (method === 'REPORT') {
      if (body.includes('calendar-multiget')) return xml(remindersXml());
      return xml(eventsReport);
    }
    if (method === 'PUT') {
      puts.push({ url: requestedUrl, body, headers: options.headers });
      const uid = body.match(/UID:([^\r\n]+)/)?.[1];
      if (uid) store.set(uid, { href: requestedUrl, ics: body });
      return new Response('', { status: 201, headers: { etag: 'fresh-etag' } });
    }
    if (method === 'GET') {
      const entry = [...store.values()].find((item) => item.href === requestedUrl);
      if (!entry) return new Response('not found', { status: 404 });
      return new Response(entry.ics, { status: 200, headers: { etag: 'get-etag' } });
    }
    if (method === 'DELETE') {
      const entry = [...store.entries()].find(([, item]) => item.href === requestedUrl);
      if (entry) store.delete(entry[0]);
      return new Response('', { status: 204 });
    }
    throw Error(`unexpected ${method} ${requestedUrl}`);
  };
  try {
    const status = await connectICloud(
      owner,
      'family@icloud.com',
      'abcd-efgh-ijkl-mnop',
    );
    assert.equal(status.reminderLists.length, 1);
    assert.equal(status.reminderLists[0].name, 'Shopping');
    assert.equal(status.shoppingListId, status.reminderLists[0].id);

    const merged = await syncShoppingItems(
      owner,
      [
        { id: 'a', text: 'Milk' },
        {
          id: 'b',
          text: 'Eggs',
          uid: 'egg-1',
          href: `${listHref}eggs.ics`,
          etag: 'e1',
          remoteChecked: false,
        },
      ],
      ['b'],
    );
    assert.equal(merged.items.length, 3);
    const milk = merged.items.find((item) => item.text === 'Milk');
    assert.ok(milk.uid && milk.href.endsWith(`${milk.uid}.ics`));
    assert.equal(milk.remoteChecked, false);
    const eggs = merged.items.find((item) => item.uid === 'egg-1');
    assert.equal(eggs.remoteChecked, true);
    assert.equal(eggs.etag, 'fresh-etag');
    const bread = merged.items.find((item) => item.uid === 'bread-1');
    assert.ok(bread);
    assert.ok(merged.checkedIds.includes(bread.id));
    assert.ok(merged.checkedIds.includes('b'));
    assert.ok(merged.checkedIds.includes('a') === false);
    assert.ok(puts.some((p) => p.body.includes('SUMMARY:Milk')));
    assert.ok(puts.some((p) => p.body.includes('STATUS:COMPLETED')));

    // Remote edits pull down: Bread deleted and Eggs unchecked in iCloud.
    store.delete('bread-1');
    store.set('egg-1', {
      href: `${listHref}eggs.ics`,
      ics: todo('egg-1', 'Eggs', 'NEEDS-ACTION'),
    });
    const second = await syncShoppingItems(
      owner,
      merged.items,
      merged.checkedIds,
    );
    assert.equal(second.items.length, 2);
    assert.ok(!second.items.some((item) => item.text === 'Bread'));
    assert.ok(!second.checkedIds.includes(bread.id));
    assert.ok(!second.checkedIds.includes('b'));
    assert.ok(second.items.some((item) => item.text === 'Milk'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
