'use client';
import { RefreshCw, Trash2, X } from 'lucide-react';
import {
  artifactAsWidget,
  safeUrl,
  type Artifact,
  type WidgetState,
} from '@/app/lib/widgets/model';
import { Composition, WidgetBoundary } from './WidgetBoard';
import { CustomWidget } from './CustomWidget';
import { Freshness } from './Freshness';

export function ArtifactView({
  artifact,
  offline,
  busy,
  onClose,
  onRefine,
  onDelete,
  onState,
}: {
  artifact: Artifact;
  offline: boolean;
  busy: boolean;
  onClose: () => void;
  onRefine: (instruction: string) => void;
  onDelete: () => void;
  onState: (state: WidgetState) => void;
}) {
  const w = artifactAsWidget(artifact),
    tone = w.definition.tone;
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
      <button
        className="artifact-close"
        onClick={onClose}
        aria-label="Close visual"
        title="Close"
      >
        <X />
      </button>
      <article
        className={`hb-widget is-focused tone-${tone} ${tone !== 'cream' ? 'is-colored' : ''}`}
        aria-label={artifact.title}
      >
        <header className="widget-header">
          <div>
            <span className="widget-label">Visual answer</span>
            <h2>{artifact.title}</h2>
          </div>
        </header>
        <div className="widget-body">
          <div>
            <WidgetBoundary key={w.definitionId}>
              {w.definition.kind === 'module' ||
              w.definition.kind === 'page' ? (
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
          onClick={onDelete}
        >
          <Trash2 />
          Delete
        </button>
      </div>
      {busy && <span className="artifact-progress" aria-hidden />}
    </section>
  );
}
