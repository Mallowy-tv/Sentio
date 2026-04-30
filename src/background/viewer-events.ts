import { TAG_LABELS, formatClockTime, isDefaultProfileImageURL, scoreBand, type ChannelSnapshot, type ScoreTag, type ViewerEvent } from "../shared/analytics";
import { type ChannelSession, type SessionViewer } from "./session-types";

const MAX_VIEWER_EVENTS = 25;
const REPEATED_BIO_PREVIEW_LENGTH = 48;

export const VIEWER_REAPPEAR_EVENT_GAP_MS = 10 * 60 * 1000;

export function normalizeViewerDescription(description: string | null | undefined): string | null {
  if (typeof description !== "string") {
    return null;
  }

  const normalized = description.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized ? normalized : null;
}

export function summarizeViewerDescription(description: string): string {
  if (description.length <= REPEATED_BIO_PREVIEW_LENGTH) {
    return description;
  }

  return `${description.slice(0, REPEATED_BIO_PREVIEW_LENGTH - 1)}…`;
}

export function appendViewerEvent(session: ChannelSession, viewer: SessionViewer, event: Omit<ViewerEvent, "id">): void {
  viewer.events ??= [];
  viewer.events.push({
    id: `${session.nextViewerEventId++}`,
    ...event,
  });

  if (viewer.events.length > MAX_VIEWER_EVENTS) {
    viewer.events = viewer.events.slice(-MAX_VIEWER_EVENTS);
  }
}

export function normalizeViewerEvents<T extends { events?: ViewerEvent[] }>(viewer: T): T & { events: ViewerEvent[] } {
  viewer.events ??= [];
  return viewer as T & { events: ViewerEvent[] };
}

export function normalizeSnapshotViewerEvents(snapshot: ChannelSnapshot): ChannelSnapshot {
  snapshot.viewers.forEach((viewer) => {
    viewer.events ??= [];
  });
  return snapshot;
}

export function describeViewerScoreBand(score: number): string {
  const band = scoreBand(score);
  if (band === "suspicious") {
    return "High signal";
  }

  if (band === "watch") {
    return "Needs review";
  }

  return "Low signal";
}

export function formatViewerEventMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatTagLabels(tags: ScoreTag[]): string {
  return tags.map((tag) => TAG_LABELS[tag].label).join(", ");
}

export function describeProfileImageState(profileImageURL: string | null | undefined): string {
  if (!profileImageURL) {
    return "no avatar";
  }

  return isDefaultProfileImageURL(profileImageURL) ? "default avatar" : "custom avatar";
}

export { formatClockTime };
