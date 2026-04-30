import { formatDistanceToNowStrict } from "date-fns";
import { scoreBand, type Viewer } from "@/shared/analytics";
import { BAND_COPY } from "@/components/dashboard/viewer-filters";
import { StatusPill, ViewerEventRow, getBandSummary, getViewerEvents } from "@/components/dashboard/display";

type ViewerBreakdownModalProps = {
  viewer: Viewer | null;
  onClose: () => void;
};

export function ViewerBreakdownModal({ viewer, onClose }: ViewerBreakdownModalProps) {
  if (!viewer) {
    return null;
  }

  const viewerEvents = getViewerEvents(viewer);
  const band = scoreBand(viewer.score);
  const createdLabel = viewer.createdAt
    ? formatDistanceToNowStrict(new Date(viewer.createdAt), { addSuffix: false })
    : viewer.userInfoStatus === "pending"
      ? "Pending"
      : "Unknown";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        className="sentio-scrollbar max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl sm:max-h-[calc(100vh-3rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{viewer.username}</h2>
              <StatusPill label={BAND_COPY[band]} tone={band === "suspicious" ? "risk" : band === "watch" ? "neutral" : "trust"} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Score {viewer.score} · {getBandSummary(viewer)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[
            ["Created", createdLabel],
            ["Watch time", `${viewer.watchTimeMinutes}m`],
            ["Same day", viewer.accountsOnSameDay ? viewer.accountsOnSameDay.toString() : "—"],
            ["Profile data", viewer.userInfoStatus === "resolved" ? "Resolved" : viewer.userInfoStatus === "pending" ? "Pending" : "Unavailable"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-background/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className="mt-1 font-mono text-sm text-foreground">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="text-sm font-semibold">Score breakdown</div>
            <p className="mt-1 text-xs text-muted-foreground">These are weak surface-level signals that stack together. They are meant to guide review, not prove intent.</p>
            {viewer.scoreBreakdown.length ? (
              <div className="mt-4 space-y-2">
                {viewer.scoreBreakdown.map((item) => (
                  <div key={item.id} className="rounded-md border border-border/70 bg-card/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{item.label}</div>
                      <div className="font-mono text-sm text-[color:var(--color-warning)]">+{item.points}</div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-border/70 bg-card/60 px-3 py-2 text-sm text-muted-foreground">
                No strong surface-level signals have stacked up yet. Low signal does not confirm legitimacy.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">History</div>
                <p className="mt-1 text-xs text-muted-foreground">Current-session viewer events that explain how this account changed over time.</p>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{viewerEvents.length} events</div>
            </div>
            {viewerEvents.length ? (
              <div className="sentio-scrollbar mt-4 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {viewerEvents.map((event) => (
                  <ViewerEventRow key={event.id} event={event} />
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-border/70 bg-card/60 px-3 py-3 text-sm text-muted-foreground">No viewer history yet for this session.</div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 p-4 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Important:</span> this score uses surface-level account signals and sampled context. It is helpful for investigation, not proof.
        </div>
      </div>
    </div>
  );
}
