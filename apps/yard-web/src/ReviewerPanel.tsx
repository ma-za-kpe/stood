import { useQuery } from '@tanstack/react-query';
import type { AgReportState } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { agStudioLicenseChecked, reviewerLedgerChecked, reviewerSources } from './c5-integrations.js';
import { api } from './http.js';
import type { ProjectRoom } from './project-state.js';

const statusLabel = {
  licensed: 'Licensed',
  expiring: 'License expires soon',
  expired: 'License expired · plain table fallback',
  missing: 'License not configured · plain table fallback',
  invalid: 'License expiry is invalid · plain table fallback',
  unavailable: 'License status unavailable · plain table fallback',
} as const;

const reviewerReport: AgReportState = {
  pages: [
    {
      id: 'page-1',
      widgets: {
        '1': {
          type: 'grid',
          dataMapping: {
            cols: [
              { id: 'milestones.milestone' },
              { id: 'milestones.state' },
              { id: 'milestones.amount' },
              { id: 'milestones.due' },
            ],
          },
        },
        '2': {
          type: 'grid',
          dataMapping: {
            cols: [
              { id: 'reconciliation.milestone' },
              { id: 'reconciliation.state' },
              { id: 'reconciliation.expected' },
              { id: 'reconciliation.captured' },
              { id: 'reconciliation.ledgerState' },
              { id: 'reconciliation.reference' },
            ],
          },
        },
      },
      widgetLayout: {
        '1': { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 12 },
        '2': { xTrack: 0, yTrack: 12, xSpan: 24, ySpan: 12 },
      },
    },
  ],
  selectedPageId: 'page-1',
  panels: { filters: { collapsed: true } },
};

export function ReviewerPanel({ room }: { room: ProjectRoom }) {
  const licenseQuery = useQuery({
    queryKey: ['ag-studio-license'],
    queryFn: async ({ signal }) => agStudioLicenseChecked(await api('/ag-studio-license', { signal })),
    retry: false,
  });
  const license = licenseQuery.data?.state ?? 'unavailable';
  const key = licenseQuery.data?.licenseKey ?? '';
  const expiry = licenseQuery.data?.expiresAt ?? '';
  const ledgerQuery = useQuery({
    queryKey: ['review-ledger', room.id, room.version],
    queryFn: async ({ signal }) =>
      reviewerLedgerChecked(await api(`/yard/v1/blueprints/${encodeURIComponent(room.id)}/ledger`, { signal }), room),
    retry: false,
  });
  const sources = ledgerQuery.data ? reviewerSources(room, ledgerQuery.data) : null;

  return (
    <section aria-label="Reviewer file" className="reviewer-file">
      <div className="project-head">
        <div>
          <p className="eyebrow">AG Studio · read-only project review</p>
          <h3>Work orders and payment reconciliation</h3>
        </div>
        <span className="signal">{statusLabel[license]}</span>
      </div>
      {licenseQuery.isPending && <p role="status">Checking the AG Studio license…</p>}
      {license === 'expiring' && (
        <p role="status" className="notice">
          The AG Studio trial ends {new Date(expiry).toISOString().slice(0, 10)}. Renew before then to keep the
          dashboard; Stood’s plain review table remains available.
        </p>
      )}
      {ledgerQuery.isPending && <p role="status">Loading the project ledger for reconciliation…</p>}
      {ledgerQuery.error && (
        <p role="alert">
          The project ledger could not be checked. Retry from the project room before relying on reconciliation.
        </p>
      )}
      {sources && (license === 'licensed' || license === 'expiring') ? (
        <AgStudioProvider licenseKey={key}>
          <AgStudio
            mode="view"
            data={{ sources: [...sources] }}
            initialState={reviewerReport}
            style={{ width: '100%', height: 460 }}
            className="reviewer-file__studio"
          />
        </AgStudioProvider>
      ) : sources ? (
        <div className="reviewer-file__fallback">
          <p role="status">The dashboard is unavailable; the same reconciliation data is shown below.</p>
          <h4>Milestones</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Due (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {sources[0].data.map((row) => (
                  <tr key={row.milestone}>
                    <td>{row.milestone}</td>
                    <td>{row.state}</td>
                    <td>
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: room.currency }).format(
                        row.amount,
                      )}
                    </td>
                    <td>{row.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Payment reconciliation</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Match</th>
                  <th>Expected</th>
                  <th>Captured</th>
                  <th>Provider reference</th>
                </tr>
              </thead>
              <tbody>
                {sources[1].data.map((row) => (
                  <tr key={row.milestone}>
                    <td>{row.milestone}</td>
                    <td>{row.state}</td>
                    <td>
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: room.currency }).format(
                        row.expected,
                      )}
                    </td>
                    <td>
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: room.currency }).format(
                        row.captured,
                      )}
                    </td>
                    <td>{row.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <p className="fine">
        This view is read-only. It contains only this project’s milestones and matched payment references; it has no
        signing, funding, payout, or project-edit tools.
      </p>
    </section>
  );
}
