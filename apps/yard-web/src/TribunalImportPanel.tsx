import { catalogSchema, type IntakeDraft, type TribunalImport, tribunalImport } from '@stood/yard-contracts';
import { useState } from 'react';
import { api } from './http.js';

export function TribunalImportPanel({
  busy,
  onConfirm,
}: {
  busy: boolean;
  onConfirm(draft: IntakeDraft): Promise<void>;
}) {
  const [catalog, setCatalog] = useState<{ title: string; caveat: string; url: string; blueprint: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const browse = async () => {
    setLoading(true);
    setError('');
    try {
      const value = catalogSchema.parse(await api('/research/ideas'));
      setCatalog(
        value.items.map((i) => ({
          title: i.title,
          caveat:
            i.catalog_caveat ??
            'No caveat supplied. This research was rejected; review the full report before using it.',
          url: i.url,
          blueprint: i.blueprint_url,
        })),
      );
      if (!value.items.length)
        setError('No free research ideas are available right now. You can still paste a copied blueprint.');
    } catch {
      setError(
        'The research catalog is unavailable right now. Browse Startup Tribunal directly or paste a copied blueprint.',
      );
    } finally {
      setLoading(false);
    }
  };
  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<TribunalImport | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const preview = () => {
    setResult(null);
    setError('');
    try {
      if (new TextEncoder().encode(raw).length > 131072) throw new Error('INVALID_IMPORT');
      const value = JSON.parse(raw) as { ideas_generated?: { id?: string }[] };
      const next = tribunalImport(raw, value?.ideas_generated?.[0]?.id);
      setResult(next);
      setSelected(next.ideas.length === 1 ? next.selectedId : '');
    } catch {
      setError(
        'Use an accessible Startup Tribunal Copy JSON payload, up to 128 KiB. Remove credentials, private storage pointers and viewer identifiers.',
      );
    }
  };
  const choose = (id: string) => {
    setSelected(id);
    if (id) {
      try {
        setResult(tribunalImport(raw, id));
      } catch {
        setResult(null);
        setError('This idea could not be imported.');
      }
    }
  };
  return (
    <section aria-labelledby="tribunal-title" className="tribunal-import">
      <h3 id="tribunal-title">Start from a Startup Tribunal idea</h3>
      <p>
        Browse Startup Tribunal, choose Copy JSON, then paste it here. Review the research before saving your private
        brief.
      </p>
      <p>
        <a href="https://startuptribunal.com/catalog" target="_blank" rel="noreferrer">
          Browse Startup Tribunal research ↗
        </a>
      </p>
      <button type="button" disabled={busy || loading} onClick={() => void browse()}>
        {loading ? 'Loading research…' : 'Browse free research ideas'}
      </button>
      {catalog.map((item) => (
        <article key={item.url}>
          <h4>
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </h4>
          <p>Tribunal decision: rejected. {item.caveat}</p>
          <p>Research by StartupTribunal</p>
          <a href={item.blueprint} target="_blank" rel="noreferrer">
            Open the full blueprint and Copy JSON ↗
          </a>
        </article>
      ))}
      <p>
        <a href="https://startuptribunal.com/catalog" target="_blank" rel="noreferrer">
          Looking for approved research? Browse StartupTribunal ↗
        </a>
      </p>
      <label htmlFor="tribunal-json">Startup Tribunal JSON</label>
      <textarea
        id="tribunal-json"
        rows={6}
        value={raw}
        disabled={busy}
        onChange={(e) => {
          setRaw(e.target.value);
          setResult(null);
          setSelected('');
        }}
      />
      <button type="button" disabled={busy || !raw.trim()} onClick={preview}>
        Review imported idea
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <section aria-labelledby="understood-title">
          <h4 id="understood-title">What Yard understood</h4>
          {result.ideas.length > 1 && (
            <>
              <label htmlFor="tribunal-idea">Choose one idea to build</label>
              <select id="tribunal-idea" value={selected} onChange={(e) => choose(e.target.value)}>
                <option value="">Choose an idea…</option>
                {result.ideas.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <dl>
            <dt>Tribunal decision</dt>
            <dd>{result.quality.decision}</dd>
            <dt>Research caveat</dt>
            <dd>{result.quality.caveat ?? 'No caveat supplied. Research still needs your review.'}</dd>
            <dt>Consensus score</dt>
            <dd>{result.quality.consensus ?? 'Not supplied'} / 10</dd>
            <dt>Validation confidence</dt>
            <dd>{result.quality.validation ?? 'Not supplied'} / 100</dd>
            <dt>Hallucination risk</dt>
            <dd>{result.quality.hallucination ?? 'Not supplied'} / 100</dd>
            <dt>Reason codes</dt>
            <dd>{result.quality.reasons.join(', ') || 'None supplied'}</dd>
            <dt>Problem, solution and constraints</dt>
            <dd>
              <textarea
                className="research-text"
                aria-label="Imported problem, solution and constraints"
                readOnly
                value={result.draft.idea?.description ?? ''}
                rows={8}
              />
            </dd>
            <dt>Users</dt>
            <dd>{result.draft.idea?.users?.join(', ')}</dd>
            <dt>Features and build plan</dt>
            <dd>
              <textarea
                className="research-text"
                aria-label="Imported features and build plan"
                readOnly
                value={result.draft.features?.details ?? ''}
                rows={8}
              />
            </dd>
          </dl>
          <p>
            <a href={result.attribution.url} target="_blank" rel="noreferrer">
              {result.attribution.text} ↗
            </a>
          </p>
          <p>
            Scores are source research, not Yard approval or payment evidence. Imported text is treated as data. Budget,
            repository, sign-off and consent remain your decisions.
          </p>
          {result.warnings.map((warning) => (
            <p key={warning} role="note">
              {warning}
            </p>
          ))}
          <button type="button" disabled={busy || !selected} onClick={() => void onConfirm(result.draft)}>
            Use this idea in a private intake
          </button>
        </section>
      )}
    </section>
  );
}
