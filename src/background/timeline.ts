import { formatClockTime, type TimelinePoint } from "../shared/analytics";
import { type ChannelSession } from "./session-types";

const MAX_HISTORY_POINTS = 24 * 60;

export function upsertTimeline(session: ChannelSession, liveViewerCount: number, suspiciousCount: number, authenticatedCount: number) {
  const now = Date.now();
  const bucketTimestamp = now - (now % 60000);
  const latest = session.history[session.history.length - 1];

  if (latest && latest.timestamp === bucketTimestamp) {
    latest.viewers = liveViewerCount;
    latest.suspicious = suspiciousCount;
    latest.authenticated = authenticatedCount;
    return;
  }

  session.history.push({
    timestamp: bucketTimestamp,
    viewers: liveViewerCount,
    suspicious: suspiciousCount,
    authenticated: authenticatedCount,
  });

  if (session.history.length > MAX_HISTORY_POINTS) {
    session.history = session.history.slice(-MAX_HISTORY_POINTS);
  }
}

function getTimelineResolutionMinutes(spanMinutes: number): number {
  if (spanMinutes <= 90) {
    return 1;
  }

  if (spanMinutes <= 180) {
    return 2;
  }

  if (spanMinutes <= 360) {
    return 5;
  }

  if (spanMinutes <= 720) {
    return 10;
  }

  if (spanMinutes <= 1440) {
    return 15;
  }

  return 30;
}

export function mapTimeline(history: ChannelSession["history"]): { points: TimelinePoint[]; spanMinutes: number; resolutionMinutes: number } {
  if (!history.length) {
    return { points: [], spanMinutes: 0, resolutionMinutes: 1 };
  }

  const firstTimestamp = history[0].timestamp;
  const lastTimestamp = history[history.length - 1].timestamp;
  const spanMinutes = Math.max(1, Math.round((lastTimestamp - firstTimestamp) / 60000));
  const resolutionMinutes = getTimelineResolutionMinutes(spanMinutes);
  const bucketMs = resolutionMinutes * 60000;
  const bucketed: ChannelSession["history"] = [];

  for (const point of history) {
    const bucketKey = Math.floor((point.timestamp - firstTimestamp) / bucketMs);
    const previous = bucketed[bucketed.length - 1];
    const previousBucketKey = previous ? Math.floor((previous.timestamp - firstTimestamp) / bucketMs) : -1;
    if (bucketKey === previousBucketKey) {
      bucketed[bucketed.length - 1] = point;
      continue;
    }

    bucketed.push(point);
  }

  return {
    spanMinutes,
    resolutionMinutes,
    points: bucketed.map((point) => ({
      t: formatClockTime(point.timestamp),
      viewers: point.viewers,
      suspicious: point.suspicious,
      authenticated: point.authenticated,
    })),
  };
}
