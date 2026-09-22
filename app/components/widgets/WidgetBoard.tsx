'use client';
import Link from 'next/link';
import {
  Component,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Expand,
  Moon,
  MoreHorizontal,
  Pin,
  Plus,
  RefreshCw,
  ShoppingBasket,
  Sun,
  Undo2,
  X,
} from 'lucide-react';
import {
  columnsForWidth,
  isExpired,
  isStale,
  packWidgets,
  safeUrl,
  stepId,
  supportsSmall,
  type Columns,
  type LayoutNode,
  type Widget,
  type WidgetSize,
  type WidgetState,
} from '@/app/lib/widgets/model';
import type { Recipe } from '@/app/lib/recipes';
import { CustomWidget } from './CustomWidget';

export type WidgetAction = (
  widget: Widget,
  action: string,
  args?: Record<string, unknown>,
) => Promise<Widget | undefined>;
class WidgetBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p className="widget-note">
        This widget couldn’t be displayed. Refresh it to try again.
      </p>
    ) : (
      this.props.children
    );
  }
}

function Composition({
  widget,
  nodes,
  onToggle,
}: {
  widget: Widget;
  nodes: LayoutNode[];
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const value = widget.snapshot.data.content?.[node.id];
        if (!value) return null;
        const { text, label, items } = value;
        switch (node.type) {
          case 'columns':
            return (
              <div key={node.id} className="widget-columns">
                <Composition
                  widget={widget}
                  nodes={node.children}
                  onToggle={onToggle}
                />
              </div>
            );
          case 'heading':
            return <h3 key={node.id}>{text || label}</h3>;
          case 'metric':
            return (
              <div key={node.id} className="widget-metric">
                <span>{label}</span>
                <strong>{value.value}</strong>
                {text && <p>{text}</p>}
              </div>
            );
          case 'callout':
            return (
              <p key={node.id} className="widget-callout">
                {text}
              </p>
            );
          case 'chart': {
            const numbers = items.map((i) => Number(i.value)),
              max = Math.max(
                1,
                ...numbers.filter(Number.isFinite).map(Math.abs),
              );
            return (
              <div
                key={node.id}
                className="widget-chart"
                aria-label={text || label}
              >
                {label && <p className="widget-note">{label}</p>}
                {items.map((item, i) => (
                  <div key={i}>
                    <div>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                    <span className="widget-bar">
                      <i
                        style={{
                          width: `${Number.isFinite(numbers[i]) ? (Math.abs(numbers[i]) / max) * 100 : 0}%`,
                        }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            );
          }
          case 'comparison':
            return (
              <dl key={node.id} className="widget-comparison">
                {items.map((item, i) => (
                  <div key={i}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            );
          case 'checklist':
            return (
              <div key={node.id} className="widget-checklist">
                {items.map((item) => {
                  const id = `${node.id}-${stepId(item.label + item.value)}`,
                    checked = widget.state.checked?.includes(id) ?? false;
                  return (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(id)}
                      />
                      <span>
                        {item.label}
                        {item.value && <small>{item.value}</small>}
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          case 'steps':
            return (
              <ol key={node.id} className="widget-steps">
                {items.map((i, n) => (
                  <li key={n}>
                    <strong>{i.label}</strong>
                    {i.value && <p>{i.value}</p>}
                  </li>
                ))}
              </ol>
            );
          case 'list':
            return (
              <dl key={node.id} className="widget-list">
                {items.map((item, i) => (
                  <div key={i}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            );
          default:
            return (
              <p key={node.id} className="widget-text">
                {text}
              </p>
            );
        }
      })}
    </>
  );
}

function RecipeBody({
  widget,
  focus,
  action,
  onShopping,
  offline,
}: {
  widget: Widget;
  focus: boolean;
  action: WidgetAction;
  onShopping: (widget: Widget) => void;
  offline: boolean;
}) {
  const recipe = widget.snapshot.data.recipe;
  if (!recipe)
    return <p className="widget-note">This recipe is unavailable.</p>;
  const index = Math.max(
    0,
    recipe.steps.findIndex((s) => stepId(s) === widget.state.stepId),
  );
  return (
    <div className={`recipe-widget ${focus ? 'recipe-expanded' : ''}`}>
      <div className="widget-recipe-meta">
        {recipe.totalMinutes && <span>{recipe.totalMinutes} min</span>}
        <span>{recipe.servings || 'Family recipe'}</span>
      </div>
      {!focus && recipe.description && (
        <p className="widget-text">{recipe.description}</p>
      )}
      <div className="recipe-cooking">
        <p className="widget-label">
          Step {index + 1} of {recipe.steps.length}
        </p>
        <p
          className={
            widget.definition.summary === 'large-steps'
              ? 'recipe-instruction large'
              : 'recipe-instruction'
          }
        >
          {recipe.steps[index]}
        </p>
      </div>
      <div className="recipe-step-controls">
        <button
          aria-label="Previous recipe step"
          disabled={index === 0}
          onClick={() => void action(widget, 'step', { direction: 'previous' })}
        >
          <ChevronLeft />
          Previous
        </button>
        <button
          disabled={index === recipe.steps.length - 1}
          onClick={() => void action(widget, 'step', { direction: 'next' })}
        >
          Next step
          <ChevronRight />
        </button>
      </div>
      {focus && (
        <>
          <button
            disabled={offline}
            className="save-favourite"
            onClick={() => void action(widget, 'save_recipe')}
          >
            <Pin />
            Save as a favourite
          </button>
          <details className="widget-ingredients">
            <summary>Ingredients · {recipe.ingredients.length}</summary>
            <ul>
              {recipe.ingredients.map((ingredient, i) => (
                <li key={i}>{ingredient}</li>
              ))}
            </ul>
            <button disabled={offline} onClick={() => onShopping(widget)}>
              <ShoppingBasket />
              Add to shopping
            </button>
          </details>
          {safeUrl(recipe.videoUrl) && (
            <a
              className="widget-video"
              href={recipe.videoUrl}
              target="_blank"
              rel="noreferrer"
            >
              Watch the original video
            </a>
          )}
        </>
      )}
    </div>
  );
}

function LibraryBody({
  widget,
  action,
  onRecipe,
  offline,
}: {
  widget: Widget;
  action: WidgetAction;
  onRecipe: (recipe: Recipe) => void;
  offline: boolean;
}) {
  const [adding, setAdding] = useState(false),
    [url, setUrl] = useState(''),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const submit = async () => {
    const value = url.trim();
    if (!value || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/recipes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const data = (await response.json()) as {
        recipe?: Recipe;
        error?: string;
      };
      if (!response.ok || !data.recipe)
        throw Error(data.error || 'That recipe could not be imported.');
      setUrl('');
      setAdding(false);
      await action(widget, 'refresh');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'That recipe could not be imported.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="recipe-library">
      {widget.snapshot.data.recipes?.length ? (
        widget.snapshot.data.recipes.map((recipe) => (
          <button key={recipe.canonicalUrl} onClick={() => onRecipe(recipe)}>
            <span>
              {recipe.title}
              <small>{recipe.sourceName}</small>
            </span>
            <ChevronRight />
          </button>
        ))
      ) : (
        <p className="widget-text">
          “Find me a quick dinner.”
          <br />
          Save a recipe to keep it here.
        </p>
      )}
      {adding ? (
        <form
          className="recipe-add"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            type="url"
            ref={(element) => element?.focus()}
            required
            value={url}
            disabled={saving}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a recipe link…"
            aria-label="Recipe link"
          />
          <div>
            <button disabled={saving || !url.trim()}>
              {saving ? 'Adding…' : 'Add recipe'}
            </button>
            <button
              type="button"
              className="quiet-button"
              disabled={saving}
              onClick={() => {
                setAdding(false);
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
          {error && <p className="widget-note">{error}</p>}
        </form>
      ) : (
        <button
          className="recipe-add-button"
          disabled={offline}
          onClick={() => setAdding(true)}
        >
          <span>Add new recipe</span>
          <Plus />
        </button>
      )}
    </div>
  );
}

function CalendarBody({ widget, focus }: { widget: Widget; focus: boolean }) {
  if (!widget.snapshot.data.calendarConnected)
    return (
      <div className="calendar-empty">
        <CalendarDays />
        <p>Connect iCloud to show your family’s real plans here.</p>
        <Link href="/connections">Connect iCloud Calendar</Link>
      </div>
    );
  const events = (widget.snapshot.data.calendarEvents ?? []).slice(
    0,
    focus ? 16 : 7,
  );
  const dayKey = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  const referenceTime = Date.parse(widget.snapshot.fetchedAt),
    today = dayKey(new Date(referenceTime).toISOString()),
    tomorrow = dayKey(new Date(referenceTime + 86_400_000).toISOString());
  let previousDay = '';
  return (
    <div className="calendar-widget">
      {widget.snapshot.data.calendarError && (
        <p className="calendar-warning">
          Last update failed. Your previous events are still shown.{' '}
          <Link href="/connections">Check connection</Link>
        </p>
      )}
      {!events.length ? (
        <div className="calendar-clear">
          <CalendarDays />
          <p>No upcoming events in your selected calendars.</p>
        </div>
      ) : (
        events.map((event) => {
          const key = dayKey(event.startsAt),
            showDay = key !== previousDay;
          previousDay = key;
          const date = new Date(event.startsAt),
            day =
              key === today
                ? 'Today'
                : key === tomorrow
                  ? 'Tomorrow'
                  : new Intl.DateTimeFormat('en-AU', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                    }).format(date),
            time = event.allDay
              ? 'All day'
              : new Intl.DateTimeFormat('en-AU', {
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(date);
          return (
            <div key={event.id}>
              {showDay && <h3 className="calendar-day">{day}</h3>}
              <article className="calendar-event">
                <time dateTime={event.startsAt}>{time}</time>
                <i style={{ background: event.calendarColor }} />
                <div>
                  <strong>{event.title}</strong>
                  <small>
                    {event.calendarName}
                    {focus && event.location ? ` · ${event.location}` : ''}
                  </small>
                </div>
              </article>
            </div>
          );
        })
      )}
    </div>
  );
}

function weatherIcon(code: number, isDay = true) {
  const Icon =
    code <= 1
      ? isDay
        ? Sun
        : Moon
      : code === 2
        ? isDay
          ? CloudSun
          : CloudMoon
        : code === 3
          ? Cloud
          : code === 45 || code === 48
            ? CloudFog
            : code >= 51 && code <= 57
              ? CloudDrizzle
              : (code >= 61 && code <= 67) || (code >= 80 && code <= 82)
                ? CloudRain
                : (code >= 71 && code <= 77) || code === 85 || code === 86
                  ? CloudSnow
                  : CloudLightning;
  return <Icon />;
}

function WeatherBody({ widget, focus }: { widget: Widget; focus: boolean }) {
  const weather = widget.snapshot.data.weather,
    error = widget.snapshot.data.weatherError;
  if (!weather)
    return (
      <div className="calendar-empty">
        <CloudSun />
        <p>{error ?? 'The weather is still loading.'}</p>
      </div>
    );
  const today = weather.days[0],
    days = weather.days.slice(1, focus ? 6 : 4);
  const dayName = (date: string) =>
    new Intl.DateTimeFormat('en-AU', { weekday: 'short' }).format(
      new Date(`${date}T12:00:00`),
    );
  return (
    <div className="weather-widget">
      {error && <p className="calendar-warning">{error}</p>}
      <div className="weather-now">
        {weatherIcon(weather.code, weather.isDay)}
        <strong>{Math.round(weather.temperature)}°</strong>
        <div>
          <span>{weather.condition}</span>
          {today && (
            <small>
              H {Math.round(today.high)}° · L {Math.round(today.low)}°
              {today.rainChance > 0 ? ` · ${today.rainChance}% rain` : ''}
            </small>
          )}
        </div>
      </div>
      {focus && (
        <p className="widget-note">
          Feels like {Math.round(weather.feelsLike)}° · Wind{' '}
          {Math.round(weather.windKmh)} km/h · {weather.place}
        </p>
      )}
      <div className="weather-days">
        {days.map((day) => (
          <div className="weather-day" key={day.date}>
            <span>{dayName(day.date)}</span>
            {weatherIcon(day.code)}
            <small>
              {Math.round(day.low)}°–{Math.round(day.high)}°
            </small>
            {day.rainChance >= 20 && (
              <small className="weather-rain">{day.rainChance}%</small>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WidgetContent({
  widget,
  focus,
  action,
  onRecipe,
  onShopping,
  activeCustom,
  offline,
}: {
  widget: Widget;
  focus: boolean;
  action: WidgetAction;
  onRecipe: (recipe: Recipe) => void;
  onShopping: (widget: Widget) => void;
  activeCustom: boolean;
  offline: boolean;
}) {
  const onState = (state: WidgetState) => {
    if (!offline) void action(widget, 'state', { state });
  };
  if (isExpired(widget.snapshot))
    return (
      <div className="widget-unavailable">
        <p>This information has expired.</p>
        <button
          disabled={offline}
          onClick={() => void action(widget, 'refresh')}
        >
          <RefreshCw />
          Refresh
        </button>
      </div>
    );
  if (widget.definition.kind === 'recipe')
    return <RecipeBody {...{ widget, focus, action, onShopping, offline }} />;
  if (widget.definition.kind === 'calendar')
    return <CalendarBody widget={widget} focus={focus} />;
  if (widget.definition.kind === 'weather')
    return <WeatherBody widget={widget} focus={focus} />;
  if (widget.definition.kind === 'library')
    return <LibraryBody {...{ widget, action, onRecipe, offline }} />;
  if (widget.definition.kind === 'shopping') {
    const items = widget.snapshot.data.items ?? [];
    const renderItem = (item: (typeof items)[number]) => (
      <label key={item.id}>
        <input
          disabled={offline}
          type="checkbox"
          checked={widget.state.checked?.includes(item.id) ?? false}
          onChange={() =>
            void action(widget, 'toggle_checked', { item: item.id })
          }
        />
        <span>{item.text}</span>
      </label>
    );
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const category = item.category?.trim() || '';
      const group = groups.get(category);
      if (group) group.push(item);
      else groups.set(category, [item]);
    }
    return (
      <div className="widget-checklist">
        {items.length ? (
          items.some((item) => item.category) ? (
            [...groups].map(([category, group]) => (
              <div className="shopping-group" key={category || 'other'}>
                {!!category && <h5>{category}</h5>}
                {group.map(renderItem)}
              </div>
            ))
          ) : (
            items.map(renderItem)
          )
        ) : (
          <p className="widget-text">
            Nothing on the list yet.
            <br />
            “Add milk to shopping.”
          </p>
        )}
        {!!widget.state.checked?.length && (
          <button
            disabled={offline}
            className="quiet-button"
            onClick={() => void action(widget, 'clear_checked')}
          >
            Clear checked items
          </button>
        )}
      </div>
    );
  }
  const composition = (
    <Composition
      widget={widget}
      nodes={widget.definition.nodes}
      onToggle={(id) => {
        if (!offline) void action(widget, 'toggle_checked', { item: id });
      }}
    />
  );
  if (widget.definition.kind === 'module')
    return (
      <CustomWidget
        widget={widget}
        active={activeCustom && !offline}
        onState={onState}
        fallback={composition}
      />
    );
  return (
    <fieldset className="composition-fieldset" disabled={offline}>
      {composition}
    </fieldset>
  );
}

function WidgetShell({
  widget,
  focus,
  columns,
  action,
  onFocus,
  children,
  offline,
  busy,
}: {
  widget: Widget;
  focus: boolean;
  columns: Columns;
  action: WidgetAction;
  onFocus: (id: string | null) => void;
  children: ReactNode;
  offline: boolean;
  busy: boolean;
}) {
  const [overflow, setOverflow] = useState(false),
    body = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const measure = () =>
      setOverflow(
        !!body.current &&
          !!content.current &&
          content.current.scrollHeight > body.current.clientHeight + 3,
      );
    const observer = new ResizeObserver(measure);
    if (body.current) observer.observe(body.current);
    if (content.current) observer.observe(content.current);
    measure();
    return () => observer.disconnect();
  }, [widget, focus]);
  const source = widget.snapshot.source;
  const date = new Date(widget.snapshot.fetchedAt).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const position = widget.layouts[columns];
  return (
    <article
      className={`hb-widget tone-${widget.definition.tone} ${focus ? 'is-focused' : widget.size === 'small' ? 'is-small' : ''} ${busy ? 'is-saving' : ''}`}
      aria-label={widget.title}
      aria-busy={busy}
    >
      <header className="widget-header">
        <div>
          <span className="widget-label">
            {widget.definition.kind === 'recipe'
              ? 'Cooking'
              : widget.pinned
                ? 'On your board'
                : 'New widget'}
          </span>
          <h2>{widget.title}</h2>
        </div>
        <details className="widget-menu">
          <summary aria-label={`Options for ${widget.title}`}>
            <MoreHorizontal />
          </summary>
          <div>
            <button
              disabled={offline || busy}
              onClick={() =>
                void action(widget, widget.pinned ? 'unpin' : 'keep')
              }
            >
              <Pin />
              {widget.pinned ? 'Unpin' : 'Keep on board'}
            </button>
            <button onClick={() => onFocus(focus ? null : widget.id)}>
              <Expand />
              {focus ? 'Return to board' : 'Open widget'}
            </button>
            <button
              disabled={offline || busy}
              onClick={() => void action(widget, 'refresh')}
            >
              <RefreshCw />
              Refresh
            </button>
            <label className="widget-size-label">
              Size
              <select
                disabled={offline || busy}
                value={widget.size}
                onChange={(event) =>
                  void action(widget, 'size', {
                    size: event.target.value as WidgetSize,
                  })
                }
              >
                {supportsSmall(widget) && <option value="small">Small</option>}
                <option value="standard">Standard</option>
                <option value="wide">Wide</option>
                <option value="tall">Tall</option>
                <option value="focus">Large</option>
              </select>
            </label>
            {position && (
              <div className="widget-position">
                <span>Move</span>
                <div>
                  {[
                    { icon: ArrowLeft, dx: -1, dy: 0, label: 'left' },
                    { icon: ArrowRight, dx: 1, dy: 0, label: 'right' },
                    { icon: ArrowUp, dx: 0, dy: -1, label: 'up' },
                    { icon: ArrowDown, dx: 0, dy: 1, label: 'down' },
                  ].map(({ icon: Icon, dx, dy, label }) => (
                    <button
                      key={label}
                      aria-label={`Move ${label}`}
                      disabled={offline || busy}
                      onClick={() =>
                        void action(widget, 'move', {
                          columns,
                          x: position.x + dx,
                          y: position.y + dy,
                        })
                      }
                    >
                      <Icon />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="offline-choice">
              <input
                type="checkbox"
                checked={widget.offlineAllowed}
                disabled={offline || busy}
                onChange={(event) =>
                  void action(widget, 'offline', {
                    allowed: event.target.checked,
                  })
                }
              />
              <span>
                Keep a copy on this device
                <small>
                  Allow this widget to be read offline for 24 hours.
                </small>
              </span>
            </label>
            <details className="widget-refine">
              <summary>Change the design</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = new FormData(event.currentTarget).get(
                    'instruction',
                  );
                  const instruction = typeof value === 'string' ? value : '';
                  void action(widget, 'refine', { instruction });
                }}
              >
                <input
                  name="instruction"
                  aria-label="How should this widget change?"
                  placeholder="Make the steps larger…"
                  maxLength={800}
                  required
                />
                <button disabled={offline || busy}>Update widget</button>
              </form>
            </details>
            <button
              disabled={offline || busy}
              onClick={() => void action(widget, 'undo')}
            >
              <Undo2 />
              Undo last change
            </button>
            <button
              disabled={offline || busy}
              onClick={() => void action(widget, 'remove')}
            >
              <X />
              Remove from board
            </button>
          </div>
        </details>
      </header>
      <div ref={body} className="widget-body">
        <div ref={content}>
          <WidgetBoundary key={widget.definitionId}>{children}</WidgetBoundary>
        </div>
      </div>
      <footer className="widget-footer">
        <div>
          <span>{source}</span>
          {!source.startsWith('Example') && source !== 'Homeboard' && (
            <time dateTime={widget.snapshot.fetchedAt}>
              {offline
                ? 'Saved '
                : isStale(widget.snapshot)
                  ? 'Update due · '
                  : ''}
              {date}
            </time>
          )}
        </div>
        <button
          className="widget-expand"
          aria-label={`${focus ? 'Close' : 'Open'} ${widget.title}`}
          onClick={() => onFocus(focus ? null : widget.id)}
        >
          {focus ? <X /> : <Expand />}
        </button>
      </footer>
      {overflow && !focus && (
        <button className="widget-more" onClick={() => onFocus(widget.id)}>
          Open full widget
          <ChevronRight />
        </button>
      )}
      {focus && !!widget.snapshot.sources.length && (
        <details className="widget-sources">
          <summary>Sources</summary>
          {widget.snapshot.sources
            .filter((s) => safeUrl(s.url))
            .map((s) => (
              <a href={s.url} key={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
            ))}
        </details>
      )}
    </article>
  );
}

export function WidgetBoard({
  widgets,
  focusId,
  onFocus,
  action,
  onRecipe,
  onShopping,
  offline,
  busy,
}: {
  widgets: Widget[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
  action: WidgetAction;
  onRecipe: (recipe: Recipe) => void;
  onShopping: (widget: Widget) => void;
  offline: boolean;
  busy: Set<string>;
}) {
  const container = useRef<HTMLDivElement>(null),
    [columns, setColumns] = useState<Columns>(12);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setColumns(columnsForWidth(entry.contentRect.width)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const shown = widgets.filter((w) => !w.archived),
    placements = packWidgets(shown, columns),
    focused = shown.find((w) => w.id === focusId);
  const ordered = [...shown].sort((a, b) => {
    const p = placements.get(a.id),
      q = placements.get(b.id);
    return (p?.y ?? 0) - (q?.y ?? 0) || (p?.x ?? 0) - (q?.x ?? 0);
  });
  const render = (widget: Widget, focus = false, activeCustom = false) => (
    <WidgetShell
      {...{ widget, focus, columns, action, onFocus, offline }}
      busy={busy.has(widget.id)}
    >
      <WidgetContent
        {...{
          widget,
          focus,
          action,
          onRecipe,
          onShopping,
          offline,
          activeCustom,
        }}
      />
    </WidgetShell>
  );
  return (
    <div className="widget-board-viewport" ref={container}>
      {focused ? (
        <section className="widget-focus">
          <button className="board-back" onClick={() => onFocus(null)}>
            <ArrowLeft />
            Your board
          </button>
          <div className="widget-focus-main">{render(focused, true, true)}</div>
          <aside className="widget-focus-aside">
            {shown
              .filter(
                (w) =>
                  w.id !== focused.id &&
                  (w.definition.kind === 'shopping' ||
                    w.binding.type === 'library'),
              )
              .slice(0, 2)
              .map((w) => (
                <div key={w.id}>{render(w)}</div>
              ))}
          </aside>
        </section>
      ) : (
        <section
          className="widget-grid"
          style={{ '--columns': columns } as CSSProperties}
          aria-label="Your Homeboard widgets"
        >
          {ordered.map((widget) => {
            const p = placements.get(widget.id);
            return (
              <div
                key={widget.id}
                className="widget-slot"
                style={
                  p
                    ? {
                        gridColumn: `${p.x + 1}/span ${p.w}`,
                        gridRow: `${p.y + 1}/span ${p.h}`,
                      }
                    : undefined
                }
              >
                {render(widget, false, false)}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
