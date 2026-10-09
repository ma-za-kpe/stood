import {
  type Catalog,
  catalogSchema,
  type IntakeDraft,
  type TribunalImport,
  tribunalImport,
} from '@stood/yard-contracts';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from './http.js';
import { researchBrief } from './research-brief.js';

export function TribunalImportPanel({
  busy,
  onConfirm,
}: {
  busy: boolean;
  onConfirm(draft: IntakeDraft): Promise<void>;
}) {
  const catalog = useQuery({
    queryKey: ['research', 'ideas'],
    queryFn: async ({ signal }) => catalogSchema.parse(await api('/research/ideas', { signal })),
    staleTime: 600_000,
    retry: false,
  });
  const [filter, setFilter] = useState('');
  const [card, setCard] = useState<Catalog['items'][number] | null>(null);
  const detail = useRef<HTMLElement>(null);
  const selectCard = (item: Catalog['items'][number]) => {
    setCard(item);
    requestAnimationFrame(() => {
      detail.current?.focus();
      detail.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };
  const cards =
    catalog.data?.items.filter((item) =>
      `${item.title} ${item.problem_statement}`.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];
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
    } catch (e) {
      setError(
        (e as Error).message === 'PRIVATE_REPORT'
          ? 'This report is marked private. Use a publicly shared report.'
          : (e as Error).message === 'CREDENTIAL_IN_INTAKE'
            ? 'A credential is embedded in the research text. Remove that secret before importing; it has not been saved.'
            : 'This report could not be read. Paste the complete Copy JSON report (up to 128 KiB).',
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
      <div className="ideas-heading">
        <div>
          <p className="eyebrow">Research by StartupTribunal</p>
          <h3 id="tribunal-title">Explore ideas</h3>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={busy || catalog.isFetching}
          onClick={() => void catalog.refetch()}
        >
          Refresh ideas
        </button>
      </div>
      <p>
        Choose a research idea to review, or describe your own project. These reports were rejected by their source
        tribunal; read the caveat before using them.
      </p>
      <label htmlFor="idea-search">Search ideas</label>
      <input
        id="idea-search"
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Problem, topic or country"
      />
      {catalog.isPending && <p role="status">Loading research ideas…</p>}
      {catalog.isError && (
        <p role="alert">
          Ideas could not load. Refresh to retry, describe your own project, or{' '}
          <a href="https://startuptribunal.com/catalog" target="_blank" rel="noreferrer">
            browse the source catalog ↗
          </a>
          .
        </p>
      )}
      {catalog.isSuccess && !cards.length && (
        <p role="status">{filter ? 'No ideas match this search.' : 'No research ideas are available right now.'}</p>
      )}
      {!card && (
        <div className="idea-grid">
          {cards.map((item) => (
            <article className="idea-card" key={item.slug}>
              <span className="research-badge">Source decision: rejected</span>
              <h4>
                <button type="button" className="idea-title" disabled={busy} onClick={() => selectCard(item)}>
                  {item.title}
                </button>
              </h4>
              <p className="idea-excerpt">{item.problem_statement}</p>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => selectCard(item)}>
                View idea →
              </button>
            </article>
          ))}
        </div>
      )}
      {card && (
        <section className="idea-detail" ref={detail} tabIndex={-1} aria-labelledby="idea-detail-title">
          <div className="ideas-heading">
            <h4 id="idea-detail-title">{card.title}</h4>
            <button className="secondary-button" type="button" onClick={() => setCard(null)}>
              Close idea
            </button>
          </div>
          <p>{card.problem_statement}</p>
          <p>
            <strong>Who it is for:</strong> {card.target_customer ?? 'Not supplied by the source.'}
          </p>
          <p className="research-caveat">
            <strong>Source decision: rejected.</strong>{' '}
            {card.catalog_caveat ?? 'No caveat supplied. Review the full report before using this research.'}
          </p>
          <p>Research by StartupTribunal · {card.catalog_reason_codes.join(', ') || 'No reason codes supplied'}</p>
          <a href={card.blueprint_url} target="_blank" rel="noreferrer">
            Open the full blueprint and Copy JSON ↗
          </a>
          <p className="fine">
            Start with the catalog summary, then add your requirements. This saves a private brief; it does not approve
            the research or start a build.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              try {
                void onConfirm(researchBrief(card));
              } catch {
                setError('This research summary could not be saved safely. Try the full report import.');
              }
            }}
          >
            Use this idea in a private intake
          </button>
        </section>
      )}
      <details className="report-import">
        <summary>Import a full research report</summary>
        <p>
          Already copied a report? Paste it here to review its scores and build details. Private metadata is removed
          automatically.
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
              Scores are source research, not Yard approval or payment evidence. Imported text is treated as data.
              Budget, repository, sign-off and consent remain your decisions.
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
      </details>
    </section>
  );
}
