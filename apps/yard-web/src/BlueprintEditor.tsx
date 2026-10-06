import { useRef, useState } from 'react';
import { type EditableDraft, mergeMilestones, splitMilestone } from './blueprint-edit.js';
import { browserRequestKey } from './claim-keys.js';
export function BlueprintEditor({
  initial,
  currency,
  capMinor,
  busy,
  save,
  close,
  reload,
}: {
  initial: EditableDraft;
  currency: string;
  capMinor: number;
  busy: boolean;
  save(draft: EditableDraft, key: string): Promise<void>;
  close(): void;
  reload(): Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [error, setError] = useState(''),
    [submitted, setSubmitted] = useState(false);
  const receipt = useRef<{ key: string; draft: EditableDraft } | null>(null);
  const locked = busy || submitted;
  const total = draft.milestones.reduce(
    (sum, m) => sum + BigInt(Number.isSafeInteger(m.budgetMinor) ? m.budgetMinor : 0),
    0n,
  );
  const price = (minor: number) => new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
  const change = (work: (next: EditableDraft) => void) => {
    if (locked) return;
    const next = structuredClone(draft);
    work(next);
    setDraft(next);
  };
  const transform = (index: number, split: boolean) => {
    try {
      setDraft(split ? splitMilestone(draft, index) : mergeMilestones(draft, index));
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Check the milestone tests.');
    }
  };
  const submit = async () => {
    if (busy) return;
    receipt.current ??= { key: browserRequestKey(), draft: structuredClone(draft) };
    setSubmitted(true);
    setError('');
    try {
      await save(receipt.current.draft, receipt.current.key);
    } catch {
      setError('The save is unresolved. Retry the same edit or reload the saved draft before making another change.');
    }
  };
  return (
    <section className="blueprint-editor" aria-label="Edit unsigned blueprint">
      <h4>Edit the unsigned blueprint</h4>
      <p>The repository and approved cap stay fixed. Changes need fresh review and baseline checks before signing.</p>
      <label htmlFor="edit-summary">Project summary</label>
      <textarea
        id="edit-summary"
        value={draft.summary}
        disabled={locked}
        onChange={(e) =>
          change((n) => {
            n.summary = e.target.value;
          })
        }
      />
      <p role="status">
        Milestone total: {price(Number(total))} / approved cap {price(capMinor)}.
      </p>
      <ol className="blueprint-timeline" aria-label="Milestone timeline">
        {draft.milestones.map((m, index) => (
          <li key={m.id}>
            <fieldset disabled={locked}>
              <legend>
                Milestone {index + 1} ·{' '}
                {index === draft.milestones.length - 1 ? 'Final: buyer usage required' : 'Intermediate: trusted checks'}
              </legend>
              <label htmlFor={`edit-name-${m.id}`}>Name</label>
              <input
                id={`edit-name-${m.id}`}
                value={m.name}
                onChange={(e) =>
                  change((n) => {
                    n.milestones[index]!.name = e.target.value;
                  })
                }
              />
              <label htmlFor={`edit-budget-${m.id}`}>Budget ({currency}, minor units)</label>
              <input
                id={`edit-budget-${m.id}`}
                type="number"
                min="1"
                step="1"
                value={Number.isFinite(m.budgetMinor) ? m.budgetMinor : ''}
                onChange={(e) =>
                  change((n) => {
                    n.milestones[index]!.budgetMinor = e.target.valueAsNumber;
                  })
                }
              />
              <label htmlFor={`edit-deadline-${m.id}`}>Deadline (UTC)</label>
              <input
                id={`edit-deadline-${m.id}`}
                type="datetime-local"
                value={Number.isFinite(m.deadline) ? new Date(m.deadline).toISOString().slice(0, 16) : ''}
                onChange={(e) =>
                  change((n) => {
                    n.milestones[index]!.deadline = Date.parse(`${e.target.value}:00Z`);
                  })
                }
              />
              <details>
                <summary>Acceptance tests ({m.tests.length})</summary>
                {m.tests.map((t, ti) => (
                  <div className="intake-field" key={`${t.id}:${t.path}`}>
                    <label htmlFor={`edit-test-${m.id}-${ti}`}>{t.path}</label>
                    <textarea
                      id={`edit-test-${m.id}-${ti}`}
                      value={t.content}
                      spellCheck={false}
                      onChange={(e) =>
                        change((n) => {
                          n.milestones[index]!.tests[ti]!.content = e.target.value;
                        })
                      }
                    />
                  </div>
                ))}
              </details>
              <div className="editor-actions">
                <button
                  type="button"
                  disabled={draft.milestones.length <= 3 || index === draft.milestones.length - 1}
                  onClick={() => transform(index, false)}
                >
                  Merge with next
                </button>
                <button
                  type="button"
                  disabled={draft.milestones.length >= 6 || m.tests.length < 2 || m.budgetMinor < 2}
                  onClick={() => transform(index, true)}
                >
                  Split tests into two
                </button>
              </div>
              {m.tests.length < 2 && <p className="fine">Splitting needs at least two distinct acceptance tests.</p>}
            </fieldset>
          </li>
        ))}
      </ol>
      <p className="fine">
        Keep 3–6 milestones. Merging keeps compatible tests; splitting distributes existing tests. Saving never executes
        them.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="editor-actions">
        <button
          type="button"
          disabled={
            busy ||
            (!submitted &&
              (total !== BigInt(capMinor) ||
                draft.milestones.some(
                  (m) => !Number.isSafeInteger(m.budgetMinor) || m.budgetMinor < 1 || !Number.isFinite(m.deadline),
                )))
          }
          onClick={() => void submit()}
        >
          {submitted ? 'Retry same edit' : 'Save draft for fresh review'}
        </button>
        {submitted ? (
          <button type="button" disabled={busy} onClick={() => void reload()}>
            Reload saved draft
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={close}>
            Discard edits
          </button>
        )}
      </div>
    </section>
  );
}
