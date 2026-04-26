import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Bot, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTimelineSpan, parseCompactNumber, scoreBand, type ChannelSnapshot } from "@/shared/analytics";
import { requestChannelAnalytics } from "@/shared/analyticsClient";

type InlineWidgetProps = {
  channelName: string;
  channelGame?: string;
  viewerCount: string;
};

const COLORS = {
  accent: "#b59cff",
  suspicious: "#ff5a6b",
};

const MINI_CHART_WIDTH = 404;
const MINI_CHART_HEIGHT = 140;

function MiniTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; color: string; name: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bt-mini-tooltip">
      <div className="bt-mini-tooltip-label">{label}</div>
      {payload.map((item) => (
        <div key={item.dataKey} className="bt-mini-tooltip-row">
          <span className="bt-mini-tooltip-dot" style={{ background: item.color }} />
          <span className="bt-mini-tooltip-name">{item.name}:</span>
          <span className="bt-mini-tooltip-value">{item.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function InlineWidget({ channelName, channelGame, viewerCount }: InlineWidgetProps) {
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null);
  const latestViewerCountRef = useRef(viewerCount);

  useEffect(() => {
    latestViewerCountRef.current = viewerCount;
  }, [viewerCount]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const response = await requestChannelAnalytics({
        channelName,
        channelGame,
        viewerCount: latestViewerCountRef.current,
      });

      if (!cancelled) {
        setSnapshot(response.snapshot);
      }
    };

    load().catch(() => undefined);
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [channelGame, channelName]);

  const viewers = useMemo(() => snapshot?.viewers ?? [], [snapshot]);
  const timeline = useMemo(() => snapshot?.timeline ?? [], [snapshot]);
  const liveFromPage = useMemo(() => parseCompactNumber(viewerCount), [viewerCount]);
  const live = useMemo(() => {
    return liveFromPage ?? snapshot?.liveViewerCount ?? timeline[timeline.length - 1]?.viewers ?? 0;
  }, [liveFromPage, snapshot, timeline]);
  const liveSuspicious = useMemo(() => snapshot?.suspiciousCount ?? timeline[timeline.length - 1]?.suspicious ?? 0, [snapshot, timeline]);
  const sampledSus = useMemo(() => viewers.filter((viewer) => scoreBand(viewer.score) === "suspicious").length, [viewers]);
  const sampledWatch = useMemo(() => viewers.filter((viewer) => scoreBand(viewer.score) === "watch").length, [viewers]);
  const susPct = useMemo(() => ((liveSuspicious / Math.max(live, 1)) * 100).toFixed(1), [live, liveSuspicious]);
  const timelineLabel = useMemo(() => {
    if (!snapshot) {
      return "Stream history";
    }

    return `${formatTimelineSpan(snapshot.timelineSpanMinutes)} history · ${snapshot.timelineResolutionMinutes}m intervals`;
  }, [snapshot]);

  async function openDashboard() {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.id) {
      return;
    }

    await runtime.sendMessage({
      type: "OPEN_DASHBOARD",
      payload: {
        channelName,
        channelGame,
        viewerCount,
      },
    });
  }

  return (
    <div className="bt-inline-shell">
      <Popover>
          <PopoverTrigger asChild>
            <button className="bt-player-counter" type="button" aria-label="Open viewer analytics">
              <Bot className="bt-player-counter-icon" />
              <span className="bt-player-counter-value">{live.toLocaleString()}</span>
              <span className="bt-player-counter-suspicious">({liveSuspicious})</span>
            </button>
        </PopoverTrigger>

        <PopoverContent align="end" sideOffset={8} className="bt-player-popup" onOpenAutoFocus={(event) => event.preventDefault()}>
          <div className="bt-player-popup-header">
            <div>
              <div className="bt-player-popup-label">Live audience</div>
              <div className="bt-player-popup-metric">
                <span className="bt-player-popup-live">{live.toLocaleString()}</span>
                <span className="bt-player-popup-live-suspicious">({liveSuspicious} suspected bots)</span>
              </div>
              <div className="bt-player-popup-subtitle">{susPct}% of current viewers flagged</div>
            </div>
            <span className="bt-player-popup-status">
              <span className="bt-player-popup-status-dot" />
              scanning
            </span>
          </div>

          <div className="bt-player-chart-wrap">
            <div className="bt-player-chart-label">{timelineLabel}</div>
            <div className="bt-player-chart">
              <AreaChart width={MINI_CHART_WIDTH} height={MINI_CHART_HEIGHT} data={timeline} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="bt-pv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="bt-ps" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.suspicious} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={COLORS.suspicious} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="t" stroke="rgba(173,173,184,0.9)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono, Consolas, monospace" }} interval={14} />
                <YAxis stroke="rgba(173,173,184,0.9)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono, Consolas, monospace" }} width={36} />
                <Tooltip content={<MiniTooltip />} cursor={{ stroke: COLORS.accent, strokeDasharray: "3 3" }} />
                <Area name="Viewers" type="monotone" dataKey="viewers" stroke={COLORS.accent} strokeWidth={1.5} fill="url(#bt-pv)" />
                <Area name="Suspicious" type="monotone" dataKey="suspicious" stroke={COLORS.suspicious} strokeWidth={1.5} fill="url(#bt-ps)" />
              </AreaChart>
            </div>
          </div>

          <div className="bt-player-stats">
            <div className="bt-player-stat-card">
              <div className="bt-player-stat-label">Suspicious</div>
              <div className="bt-player-stat-value bt-player-stat-value-danger">{sampledSus}</div>
            </div>
            <div className="bt-player-stat-card">
              <div className="bt-player-stat-label">Watch</div>
              <div className="bt-player-stat-value bt-player-stat-value-warning">{sampledWatch}</div>
            </div>
            <div className="bt-player-stat-card">
              <div className="bt-player-stat-label">Sampled</div>
              <div className="bt-player-stat-value">{viewers.length}</div>
            </div>
          </div>

          <div className="bt-player-popup-footer">
            <div className="bt-player-popup-footnote">
              <AlertTriangle className="bt-player-popup-footnote-icon" />
              Detection based on community-tab heuristics
            </div>
            <button className="bt-player-dashboard-link" type="button" onClick={openDashboard}>
              Open dashboard
              <ExternalLink className="bt-player-dashboard-link-icon" />
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
