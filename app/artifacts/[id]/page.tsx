'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import type { Artifact, WidgetState } from '../../lib/widgets/model';
import { ArtifactView } from '../../components/widgets/ArtifactView';
import { SiteNav } from '../../components/SiteNav';
import '../artifacts.css';

async function artifactApi(input: Record<string, unknown>) {
  const response = await fetch('/api/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as {
    artifact?: Artifact;
    error?: string;
  };
  if (!response.ok)
    throw Error(data.error || 'That visual could not be saved.');
  return data;
}

export default function ArtifactPage() {
  const id = useParams<{ id: string }>()?.id ?? '';
  const router = useRouter();
  const [artifact, setArtifact] = useState<Artifact | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/artifacts?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as {
          artifact?: Artifact;
          error?: string;
        };
        if (!response.ok)
          throw Error(data.error || 'That visual could not be loaded.');
        if (!cancelled) setArtifact(data.artifact ?? null);
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : 'That visual could not be loaded.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  async function act(input: Record<string, unknown>) {
    setBusy(true);
    try {
      const data = await artifactApi({ id, ...input });
      if (data.artifact) setArtifact(data.artifact);
      return data.artifact;
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="artifacts-shell artifact-detail">
      <header className="artifacts-header">
        <Link href="/artifacts" className="artifacts-brand">
          <ArrowLeft />
          <span>
            <Sparkles />
          </span>
          <div>
            Artifact<small>Your visual answer</small>
          </div>
        </Link>
        <SiteNav />
      </header>
      {error && (
        <div className="artifacts-empty">
          <Sparkles />
          <h1>{error}</h1>
          <p>
            <Link href="/artifacts">Back to your artifacts</Link>
          </p>
        </div>
      )}
      {!artifact && !error && (
        <p className="artifacts-notice">Opening your visual…</p>
      )}
      {artifact && (
        <ArtifactView
          artifact={artifact}
          offline={false}
          busy={busy}
          onClose={() => router.push('/artifacts')}
          onRefine={(instruction) =>
            void act({ action: 'refine', instruction }).catch((e) =>
              setError(
                e instanceof Error
                  ? e.message
                  : 'The visual could not be updated.',
              ),
            )
          }
          onSave={() =>
            void act({ action: 'save' }).catch((e) =>
              setError(
                e instanceof Error
                  ? e.message
                  : 'The visual could not be saved.',
              ),
            )
          }
          onDelete={() =>
            void artifactApi({ action: 'dismiss', id })
              .then(() => router.push('/artifacts'))
              .catch((e) =>
                setError(
                  e instanceof Error
                    ? e.message
                    : 'The visual could not be deleted.',
                ),
              )
          }
          onState={(state: WidgetState) => {
            void act({ action: 'state', state }).catch((e) =>
              setError(
                e instanceof Error
                  ? e.message
                  : 'That change could not be saved.',
              ),
            );
          }}
        />
      )}
    </main>
  );
}
