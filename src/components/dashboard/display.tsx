import { formatDistanceToNowStrict } from "date-fns";
import { type ComponentType } from "react";
import { TAG_LABELS, formatClockTime, scoreBand, type Channel, type Viewer, type ViewerEvent } from "@/shared/analytics";

export function StatCard({
  label,
  value,
  delta,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string | number;
  delta?: string;
  tone?: "neutral" | "success" | "danger" | "warning";
  icon: ComponentType<{ className?: string }>;
}) {
  const toneCls = {
    neutral: "text-foreground",
    success: "text-[color:var(--color-success)]",
    danger: "text-[color:var(--color-danger)]",
    warning: "text-[color:var(--color-warning)]",
  }[tone];

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">{label}</span>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {delta ? <div className="mt-1 font-mono text-xs text-muted-foreground">{delta}</div> : null}
    </div>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const band = scoreBand(score);
  const color = band === "suspicious" ? "var(--color-danger)" : band === "watch" ? "var(--color-warning)" : "var(--color-success)";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="font-mono text-xs tabular-nums" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export function TagPill({ tag }: { tag: keyof typeof TAG_LABELS }) {
  const meta = TAG_LABELS[tag];
  const cls =
    meta.kind === "risk"
      ? "border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]"
      : "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]";

  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>{meta.label}</span>;
}

export function StatusPill({ label, tone }: { label: string; tone: "risk" | "trust" | "neutral" }) {
  const cls =
    tone === "risk"
      ? "border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]"
      : tone === "trust"
        ? "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]"
        : "border-border bg-background/40 text-muted-foreground";

  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>{label}</span>;
}

export function ViewerEventRow({ event }: { event: ViewerEvent }) {
  const toneClass =
    event.kind === "score"
      ? "border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]"
      : event.kind === "profile"
        ? "border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)]"
        : "border-border bg-background/40 text-muted-foreground";
  const delta =
    typeof event.scoreBefore === "number" && typeof event.scoreAfter === "number"
      ? event.scoreAfter - event.scoreBefore
      : null;

  return (
    <div className="rounded border border-border bg-background/40 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClass}`}>
              {event.kind}
            </span>
            <span className="text-xs font-medium text-foreground">{event.title}</span>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {formatClockTime(event.at)} · {formatDistanceToNowStrict(new Date(event.at), { addSuffix: true })}
          </div>
        </div>
        {typeof event.scoreAfter === "number" ? (
          <div className="text-right">
            <div className="font-mono text-xs text-foreground">{event.scoreAfter}</div>
            {delta !== null ? (
              <div className={`text-[10px] ${delta >= 0 ? "text-[color:var(--color-warning)]" : "text-[color:var(--color-success)]"}`}>
                {delta >= 0 ? "+" : ""}
                {delta}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {event.detail ? <p className="mt-2 text-xs text-muted-foreground">{event.detail}</p> : null}
    </div>
  );
}

export function ChannelAvatar({ channel, size }: { channel: Channel; size: string }) {
  if (channel.profileImageURL) {
    return <img src={channel.profileImageURL} alt={channel.displayName} className={`${size} rounded-full object-cover ring-1 ring-border`} />;
  }

  return <span className={`${size} rounded-full ring-1 ring-border`} style={{ background: channel.avatarColor }} />;
}

export function getBandSummary(viewer: Viewer): string {
  const band = scoreBand(viewer.score);
  if (band === "suspicious") {
    return "High signal means several weak surface-level signals are stacking together. It is useful for review, not proof.";
  }

  if (band === "watch") {
    return "Needs review means Sentio sees enough weak signals to keep an eye on this account, but not enough to overstate certainty.";
  }

  return "Low signal means Sentio has not seen enough unusual surface-level evidence yet. It does not confirm legitimacy.";
}

export function getViewerEvents(viewer: Viewer): ViewerEvent[] {
  return viewer.events ?? [];
}
