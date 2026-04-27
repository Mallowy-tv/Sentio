export type Channel = {
  id: string;
  name: string;
  displayName: string;
  game: string;
  avatarColor: string;
  profileImageURL?: string | null;
};

export type ScoreTag =
  | "new_account"
  | "clustered_creation"
  | "same_day_cluster"
  | "no_description"
  | "default_avatar"
  | "missing_created_at"
  | "short_watch";

export type ScoreContribution = {
  id: string;
  label: string;
  points: number;
  detail: string;
};

export type Viewer = {
  id: string;
  username: string;
  displayName: string;
  createdAt: string | null;
  description: string | null;
  profileImageURL: string | null;
  userInfoStatus: "pending" | "resolved" | "unavailable";
  firstSeen: number;
  lastSeen: number;
  watchTimeMinutes: number;
  accountsOnSameDay: number;
  score: number;
  tags: ScoreTag[];
  scoreBreakdown: ScoreContribution[];
  present: boolean;
};

export type TimelinePoint = {
  t: string;
  viewers: number;
  suspicious: number;
  authenticated: number;
};

export type ChannelRemark = {
  id: string;
  title: string;
  description: string;
  tone: "note" | "warning";
};

export type ChannelSnapshot = {
  channel: Channel;
  streamLive: boolean;
  liveViewerCount: number;
  authenticatedCount: number;
  sampledCount: number;
  suspiciousCount: number;
  watchCount: number;
  safeCount: number;
  newAccountCount: number;
  pendingCount: number;
  updatedAt: number;
  viewers: Viewer[];
  timeline: TimelinePoint[];
  timelineSpanMinutes: number;
  timelineResolutionMinutes: number;
  remarks: ChannelRemark[];
};

export const TAG_LABELS: Record<ScoreTag, { label: string; kind: "risk" | "trust" }> = {
  new_account: { label: "New account", kind: "risk" },
  clustered_creation: { label: "Creation cluster", kind: "risk" },
  same_day_cluster: { label: "Same-day cluster", kind: "risk" },
  no_description: { label: "No bio", kind: "risk" },
  default_avatar: { label: "Default avatar", kind: "risk" },
  missing_created_at: { label: "No creation date", kind: "risk" },
  short_watch: { label: "Short watch", kind: "risk" },
};

const DEFAULT_PROFILE_IMAGE_PREFIX = "https://static-cdn.jtvnw.net/user-default-pictures-uv/";

export function isDefaultProfileImageURL(profileImageURL: string | null | undefined): boolean {
  if (!profileImageURL) {
    return false;
  }

  return profileImageURL.toLowerCase().startsWith(DEFAULT_PROFILE_IMAGE_PREFIX);
}

function hashString(value: string): number {
  return value.split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
}

export function colorFromName(name: string): string {
  return `hsl(${hashString(name) % 360} 70% 62%)`;
}

export function buildChannel(name: string, game = "Live channel"): Channel {
  const normalized = name.trim().toLowerCase();
  return {
    id: `channel_${normalized}`,
    name: normalized,
    displayName: normalized,
    game,
    avatarColor: colorFromName(normalized),
    profileImageURL: null,
  };
}

export function parseCompactNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (!value) {
    return null;
  }

  const match = String(value).trim().match(/^([\d,.]+)\s*([kKmM])?$/);
  if (!match) {
    return null;
  }

  const numeric = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "k" ? 1000 : suffix === "m" ? 1000000 : 1;
  return Math.round(numeric * multiplier);
}

export function formatCompactNumber(value: string | number | null | undefined): string {
  const numeric = typeof value === "number" ? value : parseCompactNumber(value);
  if (!numeric) {
    return "0";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: numeric >= 1000 ? 1 : 0,
  }).format(numeric);
}

export function formatTimelineSpan(minutes: number): string {
  if (minutes <= 0) {
    return "Live";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function scoreBand(score: number): "safe" | "watch" | "suspicious" {
  if (score >= 44) return "suspicious";
  if (score >= 18) return "watch";
  return "safe";
}

function toDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function bucketCreationByMonth(viewers: Viewer[], months = 72) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
  const buckets: { key: string; label: string; safe: number; suspicious: number; total: number }[] = [];

  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    buckets.push({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: formatter.format(date),
      safe: 0,
      suspicious: 0,
      total: 0,
    });
  }

  const positions = new Map(buckets.map((bucket, index) => [bucket.key, index]));
  viewers.forEach((viewer) => {
    const createdAt = toDate(viewer.createdAt);
    if (!createdAt) {
      return;
    }

    const key = `${createdAt.getFullYear()}-${createdAt.getMonth()}`;
    const position = positions.get(key);
    if (position === undefined) return;
    buckets[position].total += 1;
    if (scoreBand(viewer.score) === "suspicious") buckets[position].suspicious += 1;
    else buckets[position].safe += 1;
  });

  return buckets;
}

export function bucketWatchTime(viewers: Viewer[]) {
  const edges = [0, 1, 5, 15, 30, 60, 120, 180, 240, 360, 480, 720];

  return edges.slice(0, -1).map((min, index) => {
    const max = edges[index + 1];
    const label = max < 60 ? `${min}-${max}m` : `${Math.floor(min / 60)}-${Math.floor(max / 60)}h`;
    const bucket = { label, min, max, humans: 0, bots: 0 };

    viewers.forEach((viewer) => {
      if (viewer.watchTimeMinutes < min || viewer.watchTimeMinutes >= max) return;
      if (scoreBand(viewer.score) === "suspicious") bucket.bots += 1;
      else bucket.humans += 1;
    });

    return bucket;
  });
}

export function watchTimeStats(viewers: Viewer[]) {
  const humans = viewers.filter((viewer) => scoreBand(viewer.score) !== "suspicious");
  const bots = viewers.filter((viewer) => scoreBand(viewer.score) === "suspicious");
  const average = (items: Viewer[]) => (items.length ? Math.round(items.reduce((sum, viewer) => sum + viewer.watchTimeMinutes, 0) / items.length) : 0);
  const median = (items: Viewer[]) => {
    if (!items.length) return 0;
    const sorted = [...items].map((viewer) => viewer.watchTimeMinutes).sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
  };

  return {
    humanAvg: average(humans),
    humanMedian: median(humans),
    botAvg: average(bots),
    botMedian: median(bots),
  };
}

export function tagBreakdown(viewers: Viewer[]) {
  const counts = new Map<ScoreTag, number>();
  viewers.forEach((viewer) => {
    viewer.tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count);
}
