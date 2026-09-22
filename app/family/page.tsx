'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Trash2,
  UserRoundPlus,
  Users,
} from 'lucide-react';
import type { FamilyMember } from '../lib/widgets/model';
import {
  MEMBER_COLORS,
  MEMBER_EMOJIS,
} from '../lib/family-palette';
import '../connections/connections.css';
import './family.css';

type Calendar = { id: string; name: string; color: string };
type Message = { text: string; tone: 'success' | 'error' };

const EMPTY_FORM = { id: '', name: '', color: MEMBER_COLORS[0], emoji: '' };

export default function Family() {
  const [members, setMembers] = useState<FamilyMember[]>([]),
    [calendars, setCalendars] = useState<Calendar[]>([]),
    [calendarOwner, setCalendarOwner] = useState<Map<string, string>>(
      new Map(),
    ),
    [form, setForm] = useState({ ...EMPTY_FORM }),
    [formCalendars, setFormCalendars] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    try {
      const [family, icloud] = await Promise.all([
        fetch('/api/family', { cache: 'no-store' }).then(
          (r) =>
            r.json() as Promise<{
              members?: FamilyMember[];
              error?: string;
            }>,
        ),
        fetch('/api/connections/icloud', { cache: 'no-store' })
          .then((r) =>
            r.ok
              ? (r.json() as Promise<{
                  connected?: boolean;
                  calendars?: Calendar[];
                }>)
              : null,
          )
          .catch(() => null),
      ]);
      if (family.error) throw Error(family.error);
      const list = (family.members ?? []) as FamilyMember[];
      setMembers(list);
      setCalendarOwner(
        new Map(
          list.flatMap((m) =>
            m.calendarIds.map((id): [string, string] => [id, m.id]),
          ),
        ),
      );
      if (icloud?.connected) setCalendars(icloud.calendars ?? []);
    } catch (error) {
      setMessage({
        text:
          error instanceof Error
            ? error.message
            : 'Your family list could not load.',
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // The fetch resolves before it updates member state.
    // oxlint-disable-next-line react-compiler/react-compiler
    void load();
  }, [load]);

  async function update(input: Record<string, unknown>) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as {
        members?: FamilyMember[];
        error?: string;
      };
      if (!response.ok) throw Error(data.error || 'Family could not be saved.');
      const list = data.members ?? [];
      setMembers(list);
      setCalendarOwner(
        new Map(
          list.flatMap((m) =>
            m.calendarIds.map((id): [string, string] => [id, m.id]),
          ),
        ),
      );
      return true;
    } catch (error) {
      setMessage({
        text:
          error instanceof Error ? error.message : 'Family could not be saved.',
        tone: 'error',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function edit(member: FamilyMember) {
    setForm({
      id: member.id,
      name: member.name,
      color: member.color,
      emoji: member.emoji,
    });
    setFormCalendars(member.calendarIds);
  }

  function toggleCalendar(id: string) {
    setFormCalendars((current) =>
      current.includes(id)
        ? current.filter((c) => c !== id)
        : [...current, id],
    );
  }

  if (loading)
    return (
      <main className="connections-shell connections-loading">
        <LoaderCircle className="spin" />
        <p>Opening your family…</p>
      </main>
    );
  return (
    <main className="connections-shell">
      <header className="connections-header">
        <button
          type="button"
          className="connections-back"
          onClick={() => window.location.assign('/')}
        >
          <ArrowLeft /> Homeboard
        </button>
        <div className="connections-wordmark">
          <span>
            <Users />
          </span>
          <div>
            <strong>Family</strong>
            <small>Who lives here</small>
          </div>
        </div>
      </header>

      <section className="connection-intro">
        <p className="connection-kicker">Household</p>
        <h1>Tell Homeboard who is home.</h1>
        <p>
          Each person gets a name, an avatar and a colour. Link someone&apos;s
          calendars and the agenda shows their name on their plans — and later
          views can give everyone their own column.
        </p>
      </section>

      <div className="connection-layout">
        <section className="connection-card">
          <div className="connection-card-title">
            <span className="connection-icon">
              <UserRoundPlus />
            </span>
            <div>
              <h2>{form.id ? `Edit ${form.name}` : 'Add a person'}</h2>
              <p>A name, an avatar and a colour.</p>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void update({
                action: 'save',
                id: form.id || undefined,
                name: form.name,
                color: form.color,
                emoji: form.emoji,
                calendarIds: formCalendars,
              }).then((ok) => {
                if (ok) {
                  setForm({ ...EMPTY_FORM });
                  setFormCalendars([]);
                  setMessage({
                    text: `${form.name.trim()} has been saved.`,
                    tone: 'success',
                  });
                }
              });
            }}
          >
            <label className="family-field">
              Name
              <input
                value={form.name}
                maxLength={40}
                required
                placeholder="e.g. Alex"
                onChange={(event) =>
                  setForm((f) => ({ ...f, name: event.target.value }))
                }
              />
            </label>
            <fieldset className="family-field">
              <legend>Avatar</legend>
              <div className="emoji-grid">
                <button
                  type="button"
                  className={form.emoji === '' ? 'selected' : ''}
                  onClick={() => setForm((f) => ({ ...f, emoji: '' }))}
                  aria-label="No avatar"
                >
                  {(form.name.trim()[0] ?? '?').toUpperCase()}
                </button>
                {MEMBER_EMOJIS.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    className={form.emoji === emoji ? 'selected' : ''}
                    onClick={() => setForm((f) => ({ ...f, emoji }))}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="family-field">
              <legend>Colour</legend>
              <div className="color-grid">
                {MEMBER_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={form.color === color ? 'selected' : ''}
                    style={{ background: color }}
                    onClick={() => setForm((f) => ({ ...f, color }))}
                    aria-label={`Colour ${color}`}
                  >
                    {form.color === color && <Check />}
                  </button>
                ))}
              </div>
            </fieldset>
            {!!calendars.length && (
              <fieldset className="family-field">
                <legend>Their calendars</legend>
                {calendars.map((calendar) => {
                  const owner = calendarOwner.get(calendar.id);
                  const taken =
                    owner && owner !== form.id
                      ? members.find((m) => m.id === owner)?.name
                      : null;
                  return (
                    <label className="calendar-choice" key={calendar.id}>
                      <input
                        type="checkbox"
                        checked={formCalendars.includes(calendar.id)}
                        onChange={() => toggleCalendar(calendar.id)}
                      />
                      <i style={{ background: calendar.color }} />
                      <span>
                        {calendar.name}
                        {taken && <small> (currently {taken})</small>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            <button className="connection-primary" disabled={saving}>
              {saving ? <LoaderCircle className="spin" /> : <Check />}
              {form.id ? 'Save person' : 'Add person'}
            </button>
            {!!form.id && (
              <button
                type="button"
                className="connection-secondary"
                disabled={saving}
                onClick={() => {
                  setForm({ ...EMPTY_FORM });
                  setFormCalendars([]);
                }}
              >
                Cancel editing
              </button>
            )}
          </form>
        </section>

        <aside className="connection-card">
          <div className="connection-card-title">
            <span className="connection-icon connected">
              <Users />
            </span>
            <div>
              <h2>Your household</h2>
              <p>{members.length ? `${members.length} people` : 'Nobody yet'}</p>
            </div>
          </div>
          {!members.length && (
            <p className="connection-fineprint">
              Add everyone who lives here — events on their calendars get their
              name and colour.
            </p>
          )}
          <div className="member-list">
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <span
                  className="member-avatar"
                  style={{ background: member.color }}
                >
                  {member.emoji || member.name.trim()[0]?.toUpperCase()}
                </span>
                <div className="member-info">
                  <strong>{member.name}</strong>
                  <small>
                    {member.calendarIds.length
                      ? calendars
                          .filter((c) => member.calendarIds.includes(c.id))
                          .map((c) => c.name)
                          .join(', ') || `${member.calendarIds.length} calendars`
                      : 'No calendars linked'}
                  </small>
                </div>
                <button
                  type="button"
                  className="member-edit"
                  onClick={() => edit(member)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="member-remove"
                  aria-label={`Remove ${member.name}`}
                  disabled={saving}
                  onClick={() => {
                    if (confirm(`Remove ${member.name} from the household?`))
                      void update({ action: 'remove', id: member.id });
                  }}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>
      {message && <output className={message.tone}>{message.text}</output>}
    </main>
  );
}
