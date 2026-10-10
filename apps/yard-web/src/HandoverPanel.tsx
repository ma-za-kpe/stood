import { HANDOVER_CHECKLIST } from '@stood/yard-contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { browserRequestKey } from './claim-keys.js';
import { closeBlocker } from './handover.js';
import { api } from './http.js';
import type { OrderView, ProjectRoom } from './project-state.js';

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
      {room.orders
        .filter((o) => o.final && o.submission && !o.payment)
        .map((o) => (
          <UsageConfirm key={o.id} room={room} order={o} buyer={buyer && !done} />
        ))}
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

const usageText = {
  CONFIRMED: 'You confirmed you are using it. Yard is sending that to Stood.',
  ACCEPTED: 'Stood accepted your confirmation. It now checks the final milestone again and releases it if it passes.',
  REFUSED: 'Stood did not accept the confirmation. Ask Yard support; nothing was paid.',
} as const;
// C4 (#77): the final milestone releases only once the buyer confirms they are using what was delivered.
function UsageConfirm({ room, order, buyer }: { room: ProjectRoom; order: OrderView; buyer: boolean }) {
  const client = useQueryClient();
  const key = useRef(`usage-${browserRequestKey()}`);
  const confirm = useMutation({
    mutationFn: () =>
      api(`/blueprints/${encodeURIComponent(room.id)}/work-orders/${encodeURIComponent(order.id)}/usage`, {
        method: 'POST',
        body: '{}',
        headers: { 'If-Match': String(room.version), 'Idempotency-Key': key.current },
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ['room', room.id] }),
  });
  if (order.usage) return <p role="status">{usageText[order.usage.status]}</p>;
  if (!buyer) return <p className="fine">{order.name}: waiting for the buyer to confirm use.</p>;
  return (
    <div className="usage">
      <p>
        {order.name} is delivered. Its payment is released only once you confirm you are using it, so the builder is
        paid for something that works for you.
      </p>
      <button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
        {confirm.isPending ? 'Confirming…' : `I’m using ${order.name}`}
      </button>
      {confirm.isError && <p role="alert">{(confirm.error as Error).message}</p>}
    </div>
  );
}
