'use client';
import { ArrowLeft, Pin, RefreshCw, Trash2 } from 'lucide-react';
import {
  artifactAsWidget,
  safeUrl,
  type Artifact,
  type WidgetState,
} from '@/app/lib/widgets/model';
import { badgeFor, Composition, WidgetBoundary } from './WidgetBoard';
import { CustomWidget } from './CustomWidget';
import { Freshness } from './Freshness';

export function ArtifactView({
  artifact,
  offline,
  busy,
  onBack,
  onKeep,
  onRefine,
  onDismiss,
  onState,
}: {
  artifact: Artifact;
  offline: boolean;
  busy: boolean;
  onBack: () => void;
  onKeep: () => void;
  onRefine: (instruction: string) => void;
  onDismiss: () => void;
  onState: (state: WidgetState) => void;
}) {
  const w = artifactAsWidget(artifact),
    tone = w.definition.tone,
    BadgeIcon = badgeFor(w).icon;
  const composition = (
    <Composition
      widget={w}
      nodes={w.definition.nodes}
      onToggle={(id) => {
        if (offline) return;
        const checked = w.state.checked ?? [];
        onState({
          ...w.state,
          checked: checked.includes(id)
            ? checked.filter((x) => x !== id)
            : [...checked, id].slice(0, 200),
        });
      }}
    />
  );
  return (
    <section className="artifact-view">
      <button className="board-back" onClick={onBack}>
        <ArrowLeft />
        Your board
      </button>
      <article
        className={`hb-widget is-focused tone-${tone} ${tone !== 'cream' ? 'is-colored' : ''}`}
        aria-label={artifact.title}
      >
        <span
          className="widget-icon-badge"
          style={{ color: badgeFor(w).color }}
          aria-hidden
        >
          <BadgeIcon />
        </span>
        <header className="widget-header">
          <div>
            <span className="widget-label">Visual answer</span>
            <h2>{artifact.title}</h2>
          </div>
        </header>
        <div className="widget-body">
          <div>
            <WidgetBoundary key={w.definitionId}>
              {w.definition.kind === 'module' ? (
                <CustomWidget
                  widget={w}
                  active={!offline}
                  onState={onState}
                  fallback={composition}
                />
              ) : (
                <fieldset className="composition-fieldset" disabled={offline}>
                  {composition}
                </fieldset>
              )}
            </WidgetBoundary>
          </div>
        </div>
        <footer className="widget-footer">
          <div>
            <span>{w.snapshot.source}</span>
            <Freshness snapshot={w.snapshot} offline={offline} />
          </div>
        </footer>
        {!!w.snapshot.sources.length && (
          <details className="widget-sources">
            <summary>Sources</summary>
            {w.snapshot.sources
              .filter((s) => safeUrl(s.url))
              .map((s) => (
                <a href={s.url} key={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              ))}
          </details>
        )}
      </article>
      <div className="artifact-actions">
        <button
          className="primary-button"
          disabled={offline || busy}
          onClick={onKeep}
        >
          <Pin />
          Keep on board
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('instruction');
            const instruction = typeof value === 'string' ? value : '';
            if (instruction.trim()) onRefine(instruction);
          }}
        >
          <input
            name="instruction"
            aria-label="How should this visual change?"
            placeholder="Make it a chart…"
            maxLength={800}
            required
          />
          <button disabled={offline || busy}>
            <RefreshCw />
            Change
          </button>
        </form>
        <button
          className="quiet-button"
          disabled={offline || busy}
          onClick={onDismiss}
        >
          <Trash2 />
          Discard
        </button>
      </div>
    </section>
  );
}
