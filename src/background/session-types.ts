import { buildChannel, type Channel, type ChannelSnapshot, type Viewer } from "../shared/analytics";

export type SessionViewer = Omit<Viewer, "present" | "displayName" | "scoreBreakdown">;

export type ChannelHistoryPoint = {
  timestamp: number;
  viewers: number;
  suspicious: number;
  authenticated: number;
};

export type ChannelSession = {
  channel: Channel;
  viewers: Map<string, SessionViewer>;
  pendingUsernames: Set<string>;
  history: ChannelHistoryPoint[];
  nextViewerEventId: number;
  latestSnapshot?: ChannelSnapshot;
  lastExperimentalSignalsEnabled?: boolean;
  lastFetchedAt: number;
  refreshPromise?: Promise<ChannelSnapshot>;
  enrichmentPromise?: Promise<void>;
};

export const sessions = new Map<string, ChannelSession>();

export function clearChannelSession(channelName: string): boolean {
  return sessions.delete(channelName.toLowerCase());
}

export function getActiveChannels(): Channel[] {
  const cutoff = Date.now() - 45_000;
  return Array.from(sessions.values())
    .filter((session) => session.lastFetchedAt >= cutoff && (session.latestSnapshot?.liveViewerCount ?? 0) > 0)
    .map((session) => session.channel)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function ensureSession(channelName: string, game?: string, avatarColor?: string): ChannelSession {
  const key = channelName.toLowerCase();
  const existing = sessions.get(key);
  if (existing) {
    existing.channel = {
      ...existing.channel,
      displayName: existing.channel.displayName || existing.channel.name,
      game: game || existing.channel.game,
      avatarColor: avatarColor || existing.channel.avatarColor,
    };
    return existing;
  }

  const channel = buildChannel(channelName, game || "Live channel");
  const session: ChannelSession = {
    channel: {
      ...channel,
      avatarColor: avatarColor || channel.avatarColor,
    },
    viewers: new Map<string, SessionViewer>(),
    pendingUsernames: new Set<string>(),
    history: [],
    nextViewerEventId: 1,
    lastFetchedAt: 0,
  };
  sessions.set(key, session);
  return session;
}
