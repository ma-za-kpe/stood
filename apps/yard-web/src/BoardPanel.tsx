import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { boardChecked, claimAck, type Offer } from './board-contract.js';
import { ClaimKeys } from './claim-keys.js';
import { api } from './http.js';
export function BoardPanel({
  enabled,
  generation,
  onOpen,
}: {
  enabled: boolean;
  generation: number;
  onOpen(id: string): void;
}) {
  const client = useQueryClient(),
    [filter, setFilter] = useState('');
  const keys = useRef(new ClaimKeys());
  const board = useInfiniteQuery({
    queryKey: ['board', generation],
    enabled,
    initialPageParam: '',
    queryFn: async ({ pageParam, signal }) =>
      boardChecked(
        await api(`/board${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ''}`, { signal }),
        pageParam,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const claim = useMutation({
    mutationFn: async (o: Offer) => {
      const key = keys.current.for(o.id, o.version);
      const ack = claimAck.parse(
        await api(
          `/blueprints/${encodeURIComponent(o.projectId)}/work-orders/${encodeURIComponent(o.workOrderId)}/claim`,
          { method: 'POST', headers: { 'If-Match': String(o.version), 'Idempotency-Key': key }, body: '{}' },
        ),
      );
      if (ack.id !== o.projectId || ack.version !== o.version + 1)
        throw new Error('The claim acknowledgement did not match this work. Checking the server.');
      return o.projectId;
    },
    onSuccess: async (id) => {
      await client.invalidateQueries({ queryKey: ['board'] });
      onOpen(id);
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ['board'] });
    },
  });
  const offers =
    board.data?.pages
      .flatMap((p) => p.orders)
      .filter((o) => `${o.name} ${o.profile} ${o.currency}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return (
    <section className="board-panel" aria-labelledby="board-title">
      <div className="project-head">
        <div>
          <p className="eyebrow">Fixed scope / fixed price</p>
          <h2 id="board-title">Pick work. Stand behind it.</h2>
        </div>
        <span className="signal">SIMULATED BOARD</span>
      </div>
      <p className="lede">
        Ordinary builder accounts use the same Board. A claim reserves a lease; funding and payment need their own
        confirmed records.
      </p>
      <label htmlFor="board-filter">Filter loaded work</label>
      <input
        id="board-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Name, profile or currency"
      />
      {!enabled && <p role="status">Choose a simulated operator above to load the Board.</p>}
      {board.isFetching && <p role="status">Loading posted work…</p>}
      {board.error && <p role="alert">{board.error.message}</p>}
      {claim.error && <p role="alert">{claim.error.message} No payment is implied by this acknowledgement.</p>}
      <div className="board-grid">
        {offers.map((o) => (
          <article className="work-card" key={o.id}>
            <p className="eyebrow">Posted / {o.profile}</p>
            <h3>{o.name}</h3>
            <p className="budget">
              {new Intl.NumberFormat('en', { style: 'currency', currency: o.currency }).format(o.priceMinor / 100)}
            </p>
            <p className="fine">Fixed price. No bidding. Repository access follows a scoped claim.</p>
            <button type="button" disabled={!enabled || claim.isPending} onClick={() => claim.mutate(o)}>
              {claim.isPending && claim.variables?.id === o.id ? 'Clocking in…' : 'Clock in →'}
            </button>
          </article>
        ))}
      </div>
      {enabled && !board.isFetching && !board.error && offers.length === 0 && (
        <div className="empty">
          <h3>No posted work in these pages.</h3>
          <p>
            {board.hasNextPage
              ? 'More pages are available below.'
              : 'Try another filter or return after work is posted.'}
          </p>
        </div>
      )}
      {board.hasNextPage && (
        <button type="button" disabled={board.isFetchingNextPage} onClick={() => void board.fetchNextPage()}>
          {board.isFetchingNextPage ? 'Loading next page…' : 'Load more work →'}
        </button>
      )}
    </section>
  );
}
