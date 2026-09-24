'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Cloud,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';
import './connections.css';

type Status = {
  connected: boolean;
  accountEmail?: string;
  calendars: { id: string; name: string; color: string }[];
  selectedCalendarIds: string[];
  reminderLists: { id: string; name: string; color: string }[];
  shoppingListId: string | null;
  shoppingSyncedAt: string | null;
  shoppingError: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};
type Message = { text: string; tone: 'success' | 'error' };
const EMPTY: Status = {
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
export default function Connections() {
  const [status, setStatus] = useState<Status>(EMPTY),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [shoppingList, setShoppingList] = useState<string | null>(null),
    [message, setMessage] = useState<Message | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/connections/icloud', {
        cache: 'no-store',
      });
      const data = (await response.json()) as Status & { error?: string };
      if (!response.ok) throw Error(data.error || 'Connection could not load.');
      setStatus(data);
      setSelected(data.selectedCalendarIds);
      setShoppingList(data.shoppingListId ?? null);
    } catch (error) {
      setMessage({
        text:
          error instanceof Error ? error.message : 'Connection could not load.',
        tone: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // The fetch resolves before it updates connection state.
    // oxlint-disable-next-line react-compiler/react-compiler
    void load();
  }, [load]);
  async function update(input: Record<string, unknown>) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/connections/icloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as Status & { error?: string };
      if (!response.ok)
        throw Error(data.error || 'iCloud could not be updated.');
      setStatus(data);
      setSelected(data.selectedCalendarIds);
      setShoppingList(data.shoppingListId ?? null);
      setPassword('');
      return data;
    } catch (error) {
      setMessage({
        text:
          error instanceof Error
            ? error.message
            : 'iCloud could not be updated.',
        tone: 'error',
      });
      return null;
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <main className="connections-shell connections-loading">
        <LoaderCircle className="spin" />
        <p>Opening connections…</p>
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
            <Cloud />
          </span>
          <div>
            <strong>Connections</strong>
            <small>Private household sources</small>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <section className="connection-intro">
        <p className="connection-kicker">Family calendar</p>
        <h1>Bring your iCloud plans into Homeboard.</h1>
        <p>
          Choose the calendars that belong on the kitchen screen. Homeboard
          reads upcoming events and keeps the widget current; it cannot add,
          change or delete events. Pick a reminder list and the Shopping
          widget stays in sync with it both ways.
        </p>
      </section>

      {!status.connected ? (
        <div className="connection-layout">
          <form
            className="connection-card connection-form"
            onSubmit={(event) => {
              event.preventDefault();
              void update({ action: 'connect', email, password }).then(
                (result) => {
                  if (result)
                    setMessage({
                      text: 'iCloud is connected. Your calendar widget is now live.',
                      tone: 'success',
                    });
                },
              );
            }}
          >
            <div className="connection-card-title">
              <span className="connection-icon">
                <CalendarDays />
              </span>
              <div>
                <h2>Connect iCloud Calendar</h2>
                <p>Use a separate password made for Homeboard.</p>
              </div>
            </div>
            <label>
              Apple Account email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="name@icloud.com"
                required
              />
            </label>
            <label>
              App-specific password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                placeholder="xxxx-xxxx-xxxx-xxxx"
                required
              />
            </label>
            <button className="connection-primary" disabled={saving}>
              {saving ? <LoaderCircle className="spin" /> : <Cloud />}
              Connect calendar
            </button>
            <div className="privacy-note">
              <ShieldCheck />
              <p>
                Your password is encrypted before storage and never returned to
                this device. Homeboard uses it only with Apple’s calendar
                service.
              </p>
            </div>
          </form>

          <aside className="connection-card connection-steps">
            <p className="connection-kicker">Make the password</p>
            <ol>
              <li>
                Open{' '}
                <a
                  href="https://account.apple.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  account.apple.com <ExternalLink />
                </a>
              </li>
              <li>Choose Sign-In and Security.</li>
              <li>Choose App-Specific Passwords.</li>
              <li>Create one named “Homeboard”, then paste it here.</li>
            </ol>
            <p className="connection-fineprint">
              Apple requires two-factor authentication. You can revoke this
              password from your Apple Account at any time.
            </p>
          </aside>
        </div>
      ) : (
        <div className="connection-layout">
          <section className="connection-card calendar-picker">
            <div className="connection-card-title">
              <span className="connection-icon connected">
                <Check />
              </span>
              <div>
                <h2>iCloud connected</h2>
                <p>{status.accountEmail}</p>
              </div>
            </div>
            <fieldset>
              <legend>Show these calendars</legend>
              {status.calendars.map((calendar) => (
                <label className="calendar-choice" key={calendar.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(calendar.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, calendar.id]
                          : current.filter((id) => id !== calendar.id),
                      )
                    }
                  />
                  <i style={{ background: calendar.color }} />
                  <span>{calendar.name}</span>
                </label>
              ))}
            </fieldset>
            {status.reminderLists.length > 0 && (
              <fieldset>
                <legend>Sync the Shopping widget with</legend>
                <label className="calendar-choice">
                  <input
                    type="radio"
                    name="shopping-list"
                    checked={shoppingList === null}
                    onChange={() => setShoppingList(null)}
                  />
                  <i />
                  <span>No reminder list</span>
                </label>
                {status.reminderLists.map((list) => (
                  <label className="calendar-choice" key={list.id}>
                    <input
                      type="radio"
                      name="shopping-list"
                      checked={shoppingList === list.id}
                      onChange={() => setShoppingList(list.id)}
                    />
                    <i style={{ background: list.color }} />
                    <span>{list.name}</span>
                  </label>
                ))}
                {status.shoppingError && (
                  <p className="connection-error">{status.shoppingError}</p>
                )}
              </fieldset>
            )}
            <button
              className="connection-primary"
              disabled={saving || !selected.length}
              onClick={() =>
                void update({
                  action: 'select',
                  calendarIds: selected,
                  shoppingListId: shoppingList,
                }).then((result) => {
                  if (result)
                    setMessage({
                      text: 'Your calendar choices have been saved.',
                      tone: 'success',
                    });
                })
              }
            >
              {saving ? <LoaderCircle className="spin" /> : <Check />}
              Save calendars
            </button>
          </section>
          <aside className="connection-card connection-health">
            <p className="connection-kicker">Connection health</p>
            <div className={`health-status ${status.status}`}>
              <i />
              <div>
                <strong>
                  {status.status === 'attention'
                    ? 'Needs attention'
                    : 'Up to date'}
                </strong>
                <small>
                  {status.lastSyncedAt
                    ? `Updated ${new Date(status.lastSyncedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}`
                    : 'Waiting for the first update'}
                </small>
              </div>
            </div>
            {status.lastError && (
              <p className="connection-error">{status.lastError}</p>
            )}
            <button
              className="connection-secondary"
              disabled={saving}
              onClick={() =>
                void update({ action: 'sync' }).then((result) => {
                  if (result)
                    setMessage({
                      text: 'Calendar updated from iCloud.',
                      tone: 'success',
                    });
                })
              }
            >
              <RefreshCw /> Update now
            </button>
            <button
              className="connection-danger"
              disabled={saving}
              onClick={() => {
                if (
                  confirm(
                    'Disconnect iCloud and remove its cached events from Homeboard?',
                  )
                )
                  void update({ action: 'disconnect' }).then((result) => {
                    if (result)
                      setMessage({
                        text: 'iCloud has been disconnected.',
                        tone: 'success',
                      });
                  });
              }}
            >
              <Unplug /> Disconnect iCloud
            </button>
          </aside>
        </div>
      )}
      {message && <output className={message.tone}>{message.text}</output>}
    </main>
  );
}
