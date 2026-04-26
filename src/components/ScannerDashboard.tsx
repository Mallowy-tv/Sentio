import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  CircleHelp,
  Eye,
  Filter,
  Info,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  TAG_LABELS,
  bucketCreationByMonth,
  bucketWatchTime,
  buildChannel,
  formatTimelineSpan,
  scoreBand,
  tagBreakdown,
  type Channel,
  type ChannelSnapshot,
  type Viewer,
  watchTimeStats,
} from "@/shared/analytics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Filter = "all" | "suspicious" | "watch" | "safe";

const COLORS = {
  safe: "var(--color-success)",
  suspicious: "var(--color-danger)",
  watch: "var(--color-warning)",
  accent: "var(--color-accent)",
  muted: "var(--color-muted-foreground)",
};

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; color: string; name: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      {payload.map((item) => (
        <div key={item.dataKey} className="flex items-center gap-2 font-mono">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
          <span className="text-muted-foreground">{item.name}:</span>
          <span className="text-foreground">{item.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({
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

function ScoreBar({ score }: { score: number }) {
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

function TagPill({ tag }: { tag: keyof typeof TAG_LABELS }) {
  const meta = TAG_LABELS[tag];
  const cls =
    meta.kind === "risk"
      ? "border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]"
      : "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]";

  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>{meta.label}</span>;
}

function StatusPill({ label, tone }: { label: string; tone: "risk" | "trust" }) {
  const cls =
    tone === "risk"
      ? "border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]"
      : "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]";

  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>{label}</span>;
}

function ChannelAvatar({ channel, size }: { channel: Channel; size: string }) {
  if (channel.profileImageURL) {
    return <img src={channel.profileImageURL} alt={channel.displayName} className={`${size} rounded-full object-cover ring-1 ring-border`} />;
  }

  return <span className={`${size} rounded-full ring-1 ring-border`} style={{ background: channel.avatarColor }} />;
}

function ChartFrame({
  height,
  children,
}: {
  height: number;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setWidth(Math.max(Math.floor(element.getBoundingClientRect().width), 0));
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {width > 0 ? children({ width, height }) : null}
    </div>
  );
}

export function ScannerDashboard({
  initialChannelName,
  channels,
  analytics,
  onChannelChange,
}: {
  initialChannelName?: string;
  channels?: Channel[];
  analytics?: ChannelSnapshot | null;
  onChannelChange?: (channel: Channel) => void;
}) {
  const resolvedInitialChannel = useMemo(() => buildChannel(initialChannelName || "twitch", "Live channel"), [initialChannelName]);
  const availableChannels = useMemo(() => {
    const sourceChannels = channels?.length ? channels : [resolvedInitialChannel];

    if (sourceChannels.some((channel) => channel.name === resolvedInitialChannel.name)) {
      return sourceChannels;
    }
    return [resolvedInitialChannel, ...sourceChannels];
  }, [channels, resolvedInitialChannel]);

  const [selectedChannelName, setSelectedChannelName] = useState(availableChannels[0]?.name ?? resolvedInitialChannel.name);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Viewer | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setSelectedChannelName((current) =>
      availableChannels.some((item) => item.name === current) ? current : availableChannels[0]?.name ?? resolvedInitialChannel.name,
    );
  }, [availableChannels, resolvedInitialChannel.name]);

  const channel = availableChannels.find((item) => item.name === selectedChannelName) ?? availableChannels[0] ?? resolvedInitialChannel;
  const activeAnalytics = analytics?.channel.name === channel.name ? analytics : null;
  const viewers = useMemo(() => activeAnalytics?.viewers ?? [], [activeAnalytics]);
  const timeline = useMemo(() => activeAnalytics?.timeline ?? [], [activeAnalytics]);
  const timelineSubtitle = useMemo(() => {
    if (!activeAnalytics) {
      return "Live history";
    }

    return `${formatTimelineSpan(activeAnalytics.timelineSpanMinutes)} history · ${activeAnalytics.timelineResolutionMinutes}m intervals`;
  }, [activeAnalytics]);
  const monthBuckets = useMemo(() => bucketCreationByMonth(viewers, 72), [viewers]);
  const watchBuckets = useMemo(() => bucketWatchTime(viewers), [viewers]);
  const watchStats = useMemo(() => watchTimeStats(viewers), [viewers]);
  const tagStats = useMemo(() => tagBreakdown(viewers), [viewers]);
  const remarks = useMemo(() => activeAnalytics?.remarks ?? [], [activeAnalytics]);

  const totals = useMemo(() => {
    return {
      live: activeAnalytics?.liveViewerCount ?? 0,
      suspicious: activeAnalytics?.suspiciousCount ?? 0,
      watch: activeAnalytics?.watchCount ?? 0,
      safe: activeAnalytics?.safeCount ?? 0,
      newAcc: activeAnalytics?.newAccountCount ?? 0,
      sample: activeAnalytics?.sampledCount ?? 0,
      authenticated: activeAnalytics?.authenticatedCount ?? 0,
      pending: activeAnalytics?.pendingCount ?? 0,
    };
  }, [activeAnalytics]);

  const filtered = useMemo(() => {
    let list = viewers;
    if (filter !== "all") list = list.filter((viewer) => scoreBand(viewer.score) === filter);
    if (query.trim()) {
      const lower = query.toLowerCase();
      list = list.filter((viewer) => viewer.username.toLowerCase().includes(lower));
    }
    return list;
  }, [filter, query, viewers]);

  useEffect(() => {
    setSelected((current) => current && viewers.some((viewer) => viewer.id === current.id) ? current : viewers[0] ?? null);
  }, [viewers]);

  const distributionData = [
    { name: "Safe", value: totals.safe, color: COLORS.safe },
    { name: "Watch", value: totals.watch, color: COLORS.watch },
    { name: "Suspicious", value: totals.suspicious, color: COLORS.suspicious },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-grid">
        <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
          <div className="mx-auto grid max-w-[1600px] grid-cols-[auto_1fr_auto] items-center gap-4 px-6 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-accent/30 to-primary/20 ring-1 ring-border">
                <Bot className="h-4 w-4 text-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight">Sentio</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Viewer scanner</div>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 text-xs">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-[color:var(--color-danger)]" />
                <span className="font-mono uppercase tracking-wider text-muted-foreground">Live · scanning</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger className="group flex cursor-pointer items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-1.5 text-sm transition-colors hover:border-accent/50 hover:bg-secondary/80">
                  <ChannelAvatar channel={channel} size="h-6 w-6" />
                  <div className="text-left">
                    <div className="text-sm font-medium leading-none">{channel.displayName}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{channel.game}</div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition group-data-[state=open]:rotate-180" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                    Connected channels
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {availableChannels.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      onClick={() => {
                        setSelectedChannelName(item.name);
                        onChannelChange?.(item);
                      }}
                      className="cursor-pointer gap-3 focus:bg-secondary/80 focus:text-foreground"
                    >
                      <ChannelAvatar channel={item} size="h-5 w-5" />
                      <div className="flex-1">
                        <div className="text-sm">{item.displayName}</div>
                        <div className="text-[10px] text-muted-foreground">{item.game}</div>
                      </div>
                      {item.name === selectedChannelName ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-[color:var(--color-success)]" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                aria-label="How scanning works"
                onClick={() => setShowGuide(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/60 text-muted-foreground transition-colors hover:border-accent/50 hover:bg-secondary/80 hover:text-foreground"
              >
                <CircleHelp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Live viewers" value={totals.live.toLocaleString()} icon={Eye} delta={`${totals.authenticated.toLocaleString()} authenticated`} />
            <StatCard label="Sampled" value={totals.sample} icon={Users} delta="community tab total sampling" />
            <StatCard label="Suspicious" value={totals.suspicious} icon={AlertTriangle} tone="danger" delta={totals.sample ? `${((totals.suspicious / totals.sample) * 100).toFixed(1)}% of sample` : "0% of sample"} />
            <StatCard label="Watch" value={totals.watch} icon={Activity} tone="warning" />
            <StatCard label="Safe" value={totals.safe} icon={ShieldCheck} tone="success" />
            <StatCard label="New <30d" value={totals.newAcc} icon={Bot} tone="warning" delta={`${totals.pending} pending`} />
          </section>

          {remarks.length ? (
            <section className="rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
              <div className="mb-3 flex items-center gap-2">
                <Info className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold">Channel remarks</h2>
              </div>
              <div className="space-y-2">
                {remarks.map((remark) => (
                  <div
                    key={remark.id}
                    className={`rounded-lg border px-3 py-2 ${
                      remark.tone === "warning"
                        ? "border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10"
                        : "border-accent/20 bg-accent/5"
                    }`}
                  >
                    <div className="text-sm font-medium text-foreground">{remark.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{remark.description}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Live viewers vs suspicious</h2>
                  <p className="text-xs text-muted-foreground">{timelineSubtitle}</p>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS.accent }} /> Viewers
                  </span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS.suspicious }} /> Suspicious
                  </span>
                </div>
              </div>
              <ChartFrame height={260}>
                {({ width, height }) => (
                  <AreaChart width={width} height={height} data={timeline} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.suspicious} stopOpacity={0.5} />
                        <stop offset="100%" stopColor={COLORS.suspicious} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="t" stroke="var(--color-muted-foreground)" tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} interval={9} />
                    <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--color-accent)", strokeDasharray: "3 3" }} />
                    <Area name="Viewers" type="monotone" dataKey="viewers" stroke={COLORS.accent} strokeWidth={2} fill="url(#gv)" />
                    <Area name="Suspicious" type="monotone" dataKey="suspicious" stroke={COLORS.suspicious} strokeWidth={2} fill="url(#gs)" />
                  </AreaChart>
                )}
              </ChartFrame>
            </div>

            <div className="rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
              <h2 className="text-sm font-semibold">Risk distribution</h2>
              <p className="text-xs text-muted-foreground">Of sampled viewers</p>
              <div className="mt-4 space-y-3">
                {distributionData.map((item) => {
                  const pct = (item.value / totals.sample) * 100;
                  return (
                    <div key={item.name}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                          <span className="text-foreground">{item.name}</span>
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {item.value} <span className="text-foreground/60">· {pct.toFixed(1)}%</span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full" style={{ width: `${pct}%`, background: item.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 border-t border-border pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top signals</h3>
                <ul className="space-y-1.5 text-xs">
                  {tagStats.slice(0, 6).map(({ tag, count }) => {
                    const meta = TAG_LABELS[tag];
                    return (
                      <li key={tag} className="flex items-center justify-between">
                        <span className={meta.kind === "risk" ? "text-[color:var(--color-danger)]/90" : "text-[color:var(--color-success)]/90"}>{meta.label}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">Account creation timeline</h2>
                  <p className="text-xs text-muted-foreground">Monthly creation dates of sampled viewers · suspicious accounts in red</p>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-sm" style={{ background: COLORS.accent }} /> Non-bot
                  </span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-sm" style={{ background: COLORS.suspicious }} /> Bot
                  </span>
                </div>
              </div>
              <ChartFrame height={260}>
                {({ width, height }) => (
                  <BarChart width={width} height={height} data={monthBuckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap={1}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--color-muted-foreground)" tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} interval={11} />
                    <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.25 }} />
                    <Bar name="Non-bot" dataKey="safe" stackId="a" fill={COLORS.accent} fillOpacity={0.85} />
                    <Bar name="Bot" dataKey="suspicious" stackId="a" fill={COLORS.suspicious} radius={[2, 2, 0, 0]} />
                  </BarChart>
                )}
              </ChartFrame>
              <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>{monthBuckets[0].label}</span>
                <span className="font-mono">{viewers.length} accounts · {viewers.filter((viewer) => viewer.score >= 60).length} flagged</span>
                <span>{monthBuckets[monthBuckets.length - 1].label}</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
              <h2 className="text-sm font-semibold">Viewer inspector</h2>
              <p className="text-xs text-muted-foreground">Click a row to inspect</p>
              {selected ? (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-3">
                    {selected.profileImageURL ? (
                      <img src={selected.profileImageURL} alt={selected.username} className="h-10 w-10 rounded-full ring-1 ring-border" />
                    ) : (
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold uppercase ring-1 ring-border"
                        style={{ background: `oklch(0.3 0.05 ${(selected.username.charCodeAt(0) * 7) % 360})` }}
                      >
                        {selected.username[0]}
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-medium">{selected.username}</div>
                      <div className="font-mono text-xs text-muted-foreground">@{selected.username}</div>
                    </div>
                    <ScoreBar score={selected.score} />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      ["Created", selected.createdAt ? formatDistanceToNowStrict(new Date(selected.createdAt), { addSuffix: true }) : "Unknown"],
                      ["Watching", `${selected.watchTimeMinutes}m`],
                      ["First seen", new Date(selected.firstSeen).toLocaleTimeString()],
                      ["Last seen", new Date(selected.lastSeen).toLocaleTimeString()],
                      ["Same day", selected.accountsOnSameDay ? selected.accountsOnSameDay : "—"],
                      ["Status", selected.present ? "Seen now" : "Sampled earlier"],
                    ].map(([key, value]) => (
                      <div key={key} className="rounded border border-border bg-background/40 px-2 py-1.5">
                        <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{key}</dt>
                        <dd className="font-mono text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Bio</div>
                    <div className="rounded border border-border bg-background/40 px-2 py-1.5 text-xs italic text-foreground/80">
                      {selected.description || <span className="text-muted-foreground">— empty —</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map((tag) => (
                      <TagPill key={tag} tag={tag} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-8 flex h-[200px] flex-col items-center justify-center text-center text-xs text-muted-foreground">
                  <Eye className="mb-2 h-6 w-6 opacity-40" />
                  Select a viewer from the list below to inspect their signals.
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">Time spent in stream</h2>
                  <p className="text-xs text-muted-foreground">How long sampled viewers have been watching · humans vs flagged accounts</p>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-sm" style={{ background: COLORS.accent }} /> Humans
                  </span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-sm" style={{ background: COLORS.suspicious }} /> Suspicious
                  </span>
                </div>
              </div>
              <ChartFrame height={240}>
                {({ width, height }) => (
                  <BarChart width={width} height={height} data={watchBuckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--color-muted-foreground)" tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} />
                    <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.25 }} />
                    <Bar name="Humans" dataKey="humans" stackId="w" fill={COLORS.accent} fillOpacity={0.85} />
                    <Bar name="Suspicious" dataKey="bots" stackId="w" fill={COLORS.suspicious} radius={[2, 2, 0, 0]} />
                  </BarChart>
                )}
              </ChartFrame>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Watch-time summary</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded border border-border bg-background/40 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLORS.accent }} /> Humans
                    </div>
                    <div className="mt-1 font-mono text-2xl tabular-nums">{watchStats.humanAvg}<span className="text-sm text-muted-foreground">m</span></div>
                    <div className="text-[10px] text-muted-foreground">avg · median {watchStats.humanMedian}m</div>
                  </div>
                  <div className="rounded border border-border bg-background/40 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLORS.suspicious }} /> Suspicious
                    </div>
                    <div className="mt-1 font-mono text-2xl tabular-nums text-[color:var(--color-danger)]">{watchStats.botAvg}<span className="text-sm text-muted-foreground">m</span></div>
                    <div className="text-[10px] text-muted-foreground">avg · median {watchStats.botMedian}m</div>
                  </div>
                </div>
              </div>

              <div className="col-span-2 rounded-lg border border-border bg-card/60 p-4 backdrop-blur">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Idle &lt; 5m</div>
                <p className="mt-1 text-[11px] text-muted-foreground">Accounts present but barely watching — common bot pattern.</p>
                {(() => {
                  const idleTotal = viewers.filter((viewer) => viewer.watchTimeMinutes < 5).length;
                  const idleBots = viewers.filter((viewer) => viewer.watchTimeMinutes < 5 && viewer.score >= 60).length;
                  const pct = idleTotal ? (idleBots / idleTotal) * 100 : 0;
                  return (
                    <>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-mono text-2xl tabular-nums">{idleTotal}</span>
                        <span className="text-xs text-muted-foreground">accounts</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-danger)" }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>{idleBots} flagged</span>
                        <span>{pct.toFixed(0)}% bots</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card/60 backdrop-blur">
            <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Sampled viewers</h2>
                <p className="text-xs text-muted-foreground">{filtered.length} of {totals.sample} · sampled from Twitch community tab</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search username…"
                    className="w-56 rounded-md border border-border bg-background/60 py-1.5 pl-7 pr-2 text-xs outline-none focus:border-accent"
                  />
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border bg-background/40 p-0.5 text-xs">
                  <Filter className="ml-1 h-3 w-3 text-muted-foreground" />
                  {(["all", "suspicious", "watch", "safe"] as Filter[]).map((item) => (
                    <button
                      key={item}
                      onClick={() => setFilter(item)}
                      className={`rounded px-2 py-1 capitalize transition ${filter === item ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Viewer</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 font-medium">Created</th>
                    <th className="px-4 py-2 text-right font-medium">Time</th>
                    <th className="px-4 py-2 text-right font-medium">Same day</th>
                    <th className="px-4 py-2 font-medium">Labels</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((viewer) => {
                    const band = scoreBand(viewer.score);
                    const isSelected = selected?.id === viewer.id;
                    return (
                      <tr
                        key={viewer.id}
                        onClick={() => setSelected(viewer)}
                        className={`cursor-pointer border-t border-border/60 transition hover:bg-secondary/40 ${isSelected ? "bg-secondary/60" : ""}`}
                      >
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {viewer.profileImageURL ? <img src={viewer.profileImageURL} alt={viewer.username} className="h-8 w-8 rounded-full ring-1 ring-border" /> : null}
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: band === "suspicious" ? COLORS.suspicious : band === "watch" ? COLORS.watch : COLORS.safe }}
                            />
                            <div>
                              <div className="text-sm leading-tight">{viewer.username}</div>
                              <div className="font-mono text-[10px] text-muted-foreground">@{viewer.username}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <ScoreBar score={viewer.score} />
                        </td>
                        <td className="px-4 py-2">
                          {viewer.createdAt ? (
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <span className="font-mono text-xs text-muted-foreground">
                                  {formatDistanceToNowStrict(new Date(viewer.createdAt), { addSuffix: false })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{new Date(viewer.createdAt).toLocaleDateString()}</TooltipContent>
                            </UITooltip>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{viewer.watchTimeMinutes}m</td>
                        <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{viewer.accountsOnSameDay || ""}</td>
                        <td className="px-4 py-2">
                          <div className="flex max-w-[340px] flex-wrap gap-1">
                            <StatusPill label={viewer.description ? "Has bio" : "No bio"} tone={viewer.description ? "trust" : "risk"} />
                            <StatusPill label={viewer.watchTimeMinutes >= 5 ? "Watching" : "Short watch"} tone={viewer.watchTimeMinutes >= 5 ? "trust" : "risk"} />
                            {viewer.tags.includes("new_account") ? <StatusPill label="New account" tone="risk" /> : null}
                            {viewer.accountsOnSameDay >= 5 ? <StatusPill label="Day cluster" tone="risk" /> : null}
                            {viewer.tags.includes("missing_created_at") ? <StatusPill label="No creation date" tone="risk" /> : null}
                            {viewer.tags
                              .filter((tag) => tag !== "no_description" && tag !== "missing_created_at" && tag !== "short_watch" && tag !== "same_day_cluster" && tag !== "new_account")
                              .slice(0, 2)
                              .map((tag) => (
                                <TagPill key={tag} tag={tag} />
                              ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="py-6 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Sentio · sampled via Twitch community tab
          </footer>
        </main>
        {showGuide ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
            onClick={() => setShowGuide(false)}
          >
            <div
              className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">How Sentio works</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This view estimates suspicious activity from Twitch community-tab sampling and account-enrichment signals. It is helpful for investigation, not proof.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
                >
                  Close
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-background/40 p-4">
                  <h3 className="text-sm font-semibold">Sampling</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    We repeatedly sample Twitch&apos;s community tab and keep a running session set of accounts we have seen. That means sampled totals can grow above the current authenticated count.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-4">
                  <h3 className="text-sm font-semibold">Why the numbers can look far apart</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    <span className="text-foreground">Live viewers</span> is Twitch&apos;s current stream count. <span className="text-foreground">Authenticated</span> is the signed-in community-tab count Twitch exposes. <span className="text-foreground">Sampled</span>, <span className="text-foreground">Safe</span>, <span className="text-foreground">Watch</span>, and <span className="text-foreground">Suspicious</span> are based on the running sampled session set, so they can be much higher than live when many unique accounts have been seen across repeated samples.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-4">
                  <h3 className="text-sm font-semibold">Scoring</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Scores are based on account age, creation-date clustering, same-day account density, missing bio, and short watch duration. Higher scores mean more suspicious signals, not certainty.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-4">
                  <h3 className="text-sm font-semibold">Labels</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Labels summarize the strongest signals we currently have, such as <span className="text-foreground">New account</span>, <span className="text-foreground">Day cluster</span>, <span className="text-foreground">No bio</span>, and <span className="text-foreground">Short watch</span>.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-4">
                  <h3 className="text-sm font-semibold">Watch-time and live data</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Watch-time only grows when we keep seeing an account in later samples. Live viewers come from Twitch&apos;s live count, while sampled risk totals come from the session-wide sampled set and may lag or overstate current presence.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 p-4 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Important:</span> this tool is directional. Refresh issues, signed-out viewers, Twitch sampling limits, and missing profile data can all affect the result.
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
