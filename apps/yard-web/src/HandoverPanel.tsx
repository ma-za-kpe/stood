import { HANDOVER_CHECKLIST } from '@stood/yard-contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { closeBlocker } from './handover.js';
import { browserRequestKey } from './claim-keys.js';
import { api } from './http.js';
import type { ProjectRoom } from './project-state.js';

const reasons = {
  UNPAID: 'Every milestone must be paid by Stood before the project can close.',
  UNCHECKED: 'Tick every item that is yours to confirm.',
  CLOSED: 'This project is closed.',
} as const;
// Y20 §5. Yard's own items are done by the system; the buyer confirms the rest. Money is never touched here.
export function HandoverPanel({ room, buyer }: { room: ProjectRoom; buyer: boolean }) {
  const client = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // getRandomValues, unlike randomUUID, also works on the plain-HTTP Docker test origin.
  const key = useRef(`handover-${browserRequestKey()}`);
  const close = useMutation({
    mutationFn: () =>
      api(`/blueprints/${encodeURIComponent(room.id)}/handover`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: [...checked].sort() }),
        headers: { 'If-Match': String(room.version), 'Idempotency-Key': key.current },
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ['room', room.id] }),
  });
  const blocker = closeBlocker(room, checked);
  const done = room.handover;
  return (
    <section className="handover" aria-labelledby="handover-title">
      <p className="eyebrow">Handover</p>
      <h3 id="handover-title">{done ? 'Closed. The keys are yours.' : 'Your turn. Take the keys.'}</h3>
      <ul className="checklist">
        {HANDOVER_CHECKLIST.map((item) => {
          const yard = item.owner === 'YARD';
          const ticked = yard || !!done || checked.has(item.id);
          return (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={ticked}
                  disabled={yard || !!done || !buyer}
                  onChange={(e) =>
                    setChecked((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                />
                <span>{item.label}</span>
                {yard && <span className="fine"> Yard does this.</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {!done && buyer && (
        <>
          <button
            type="button"
            className="primary"
            disabled={blocker !== null || close.isPending}
            onClick={() => close.mutate()}
          >
            {close.isPending ? 'Closing…' : 'Close the project'}
          </button>
          <p className="fine" role="status">
            {close.isError ? (close.error as Error).message : blocker ? reasons[blocker] : 'Ready to close.'}
          </p>
        </>
      )}
      {done && (
        <p className="fine">
          Closed {new Date(done.closedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC. Stored test keys are
          deleted within seven days.
        </p>
      )}
    </section>
  );
}
