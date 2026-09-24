import type {
  CalendarEvent,
  EventPeople,
  FamilyMember,
} from '../widgets/model';

export function buildEventPeopleMap(
  eventPeople: EventPeople[],
): Map<string, string[]> {
  return new Map(
    eventPeople.map((entry) => [entry.externalUid, entry.memberIds]),
  );
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mentions = (title: string, name: string) =>
  new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`,
    'iu',
  ).test(title);

export function peopleForEvent(
  event: CalendarEvent,
  members: FamilyMember[],
  eventPeople: EventPeople[] | Map<string, string[]>,
): FamilyMember[] {
  const explicit = Array.isArray(eventPeople)
    ? eventPeople.find((entry) => entry.externalUid === event.externalUid)
        ?.memberIds
    : eventPeople.get(event.externalUid);
  if (explicit) {
    const byId = new Map(members.map((member) => [member.id, member]));
    return explicit
      .map((id) => byId.get(id))
      .filter((member): member is FamilyMember => !!member);
  }
  const title = event.title.normalize('NFKC');
  const named = members.filter((member) =>
    [member.name, ...member.aliases].some((name) =>
      mentions(title, name.normalize('NFKC')),
    ),
  );
  if (named.length) return named;
  const owner = members.find((member) =>
    member.calendarIds.includes(event.calendarId),
  );
  return owner ? [owner] : [];
}
