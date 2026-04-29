import {
  buildChannel,
  formatClockTime,
  isDefaultProfileImageURL,
  parseCompactNumber,
  scoreBand,
  type Channel,
  type ChannelRemark,
  type ChannelSnapshot,
  type ScoreContribution,
  type ScoreTag,
  type TimelinePoint,
  type Viewer,
} from "../shared/analytics";
import { DASHBOARD_PAGE, DASHBOARD_STORAGE_KEY, type DashboardChannel, type DashboardContext } from "../shared/extension";
import { getUserInfoGraphQL, getViewerCount, getViewerListParallel } from "./twitchApi";

type SessionViewer = Omit<Viewer, "present" | "displayName" | "scoreBreakdown">;

type ChannelSession = {
  channel: Channel;
  viewers: Map<string, SessionViewer>;
  pendingUsernames: Set<string>;
  history: Array<{ timestamp: number; viewers: number; suspicious: number; authenticated: number }>;
  latestSnapshot?: ChannelSnapshot;
  lastFetchedAt: number;
  refreshPromise?: Promise<ChannelSnapshot>;
  enrichmentPromise?: Promise<void>;
};

const sessions = new Map<string, ChannelSession>();
const BOT_DATE_RANGE_START = "2020-01-01";
const SNAPSHOT_TTL_MS = 5_000;
const MAX_HISTORY_POINTS = 24 * 60;
const VIEWER_SAMPLE_CONCURRENT_CALLS = 20;
const USER_INFO_DRAIN_BATCH_SIZE = 200;
const LURKER_REMARK_MIN_TRACKING_MINUTES = 15;
const ACTION_ENABLED_TITLE = "Open Sentio dashboard";
const ACTION_DISABLED_TITLE = "Sentio is only available on Twitch channel pages";
const EXCLUDED_TWITCH_PATHS = new Set([
  "directory",
  "downloads",
  "jobs",
  "login",
  "messages",
  "search",
  "settings",
  "signup",
  "subscriptions",
  "turbo",
  "videos",
]);

function isTwitchChannelUrl(url?: string): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!(parsed.hostname === "twitch.tv" || parsed.hostname.endsWith(".twitch.tv"))) {
      return false;
    }

    const candidate = parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
    return Boolean(candidate) && !EXCLUDED_TWITCH_PATHS.has(candidate);
  } catch {
    return false;
  }
}

function getChannelNameFromUrl(url?: string): string | undefined {
  if (!isTwitchChannelUrl(url)) {
    return undefined;
  }

  try {
    const parsed = new URL(url!);
    return parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

async function updateActionState(tabId: number, url?: string): Promise<void> {
  const isEnabled = isTwitchChannelUrl(url);

  await chrome.action.setTitle({
    tabId,
    title: isEnabled ? ACTION_ENABLED_TITLE : ACTION_DISABLED_TITLE,
  });

  if (isEnabled) {
    await chrome.action.enable(tabId);
    return;
  }

  await chrome.action.disable(tabId);
}

async function refreshActiveTabActionState(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (typeof activeTab?.id === "number") {
    await updateActionState(activeTab.id, activeTab.url);
  }
}

refreshActiveTabActionState().catch(() => undefined);

async function buildDashboardContextFromTab(tab?: chrome.tabs.Tab): Promise<DashboardContext> {
  const channelName = getChannelNameFromUrl(tab?.url);
  if (!channelName) {
    return {};
  }

  const session = sessions.get(channelName);
  const stored = await getStoredContext();
  const storedMatch = stored?.channelName?.toLowerCase() === channelName ? stored : undefined;

  return {
    channelName,
    channelDisplayName: session?.channel.displayName || storedMatch?.channelDisplayName || channelName,
    channelGame: session?.channel.game || storedMatch?.channelGame || "Live channel",
    channelAvatarColor: session?.channel.avatarColor || storedMatch?.channelAvatarColor,
    channelProfileImageURL: session?.channel.profileImageURL || storedMatch?.channelProfileImageURL || null,
    viewerCount:
      session?.latestSnapshot?.liveViewerCount?.toString() ||
      storedMatch?.viewerCount ||
      "",
  };
}

function buildDashboardUrl(context: DashboardContext = {}): string {
  const url = new URL(chrome.runtime.getURL(DASHBOARD_PAGE));

  if (context.channelName) {
    url.searchParams.set("channel", context.channelName);
  }

  if (context.viewerCount) {
    url.searchParams.set("viewers", context.viewerCount);
  }

  return url.toString();
}

function buildChannelEntry(context: DashboardContext): DashboardChannel | null {
  if (!context.channelName) {
    return null;
  }

  return {
    name: context.channelName,
    displayName: context.channelDisplayName || context.channelName,
    game: context.channelGame || "Live channel",
    avatarColor: context.channelAvatarColor,
    profileImageURL: context.channelProfileImageURL || null,
  };
}

function mergeRecentChannels(existing: DashboardChannel[] | undefined, current: DashboardChannel | null): DashboardChannel[] {
  const merged = new Map<string, DashboardChannel>();

  if (current) {
    merged.set(current.name.toLowerCase(), current);
  }

  for (const channel of existing || []) {
    const key = channel.name.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, channel);
    }
  }

  return Array.from(merged.values()).slice(0, 8);
}

function resolveDashboardContext(context: DashboardContext, session?: ChannelSession, snapshot?: ChannelSnapshot | null): DashboardContext {
  const channel = snapshot?.channel ?? session?.channel;

  return {
    ...context,
    channelName: context.channelName || channel?.name || "",
    channelDisplayName: channel?.displayName || context.channelDisplayName || context.channelName || "",
    channelGame: channel?.game || context.channelGame || "Live channel",
    channelAvatarColor: channel?.avatarColor || context.channelAvatarColor || "",
    channelProfileImageURL: channel?.profileImageURL ?? context.channelProfileImageURL ?? null,
    viewerCount:
      context.viewerCount ||
      snapshot?.liveViewerCount?.toString() ||
      session?.latestSnapshot?.liveViewerCount?.toString() ||
      "",
  };
}

async function storeContext(context: DashboardContext = {}): Promise<void> {
  const existing = await chrome.storage.local.get([DASHBOARD_STORAGE_KEY]);
  const previous = existing[DASHBOARD_STORAGE_KEY] as DashboardContext | undefined;
  const currentChannel = buildChannelEntry(context);

  await chrome.storage.local.set({
    [DASHBOARD_STORAGE_KEY]: {
      channelName: context.channelName || "",
      channelDisplayName: context.channelDisplayName || context.channelName || "",
      channelGame: context.channelGame || "",
      channelAvatarColor: context.channelAvatarColor || "",
      channelProfileImageURL: context.channelProfileImageURL || null,
      viewerCount: context.viewerCount || "",
      recentChannels: mergeRecentChannels(previous?.recentChannels, currentChannel),
      updatedAt: Date.now(),
    } satisfies DashboardContext,
  });
}

async function getStoredContext(): Promise<DashboardContext | undefined> {
  const result = await chrome.storage.local.get([DASHBOARD_STORAGE_KEY]);
  return result[DASHBOARD_STORAGE_KEY] as DashboardContext | undefined;
}

function getActiveChannels(): Channel[] {
  const cutoff = Date.now() - 45_000;
  return Array.from(sessions.values())
    .filter((session) => session.lastFetchedAt >= cutoff && (session.latestSnapshot?.liveViewerCount ?? 0) > 0)
    .map((session) => session.channel)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function findDashboardTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  const dashboardPrefix = chrome.runtime.getURL(DASHBOARD_PAGE);
  return tabs.find((tab) => typeof tab.url === "string" && tab.url.startsWith(dashboardPrefix));
}

async function openDashboard(context: DashboardContext = {}): Promise<{ success: true; tabId?: number }> {
  await storeContext(context);
  const url = buildDashboardUrl(context);
  const existingTab = await findDashboardTab();

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { url, active: true });

    if (typeof existingTab.windowId === "number") {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }

    return { success: true, tabId: existingTab.id };
  }

  const created = await chrome.tabs.create({ url, active: true });
  return { success: true, tabId: created.id };
}

function ensureSession(channelName: string, game?: string, avatarColor?: string): ChannelSession {
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
    lastFetchedAt: 0,
  };
  sessions.set(key, session);
  return session;
}

function applyUserInfoToSession(session: ChannelSession, userInfo: Awaited<ReturnType<typeof getUserInfoGraphQL>>) {
  userInfo.forEach((user) => {
    const existing = session.viewers.get(user.username);
    if (!existing) {
      return;
    }

    if (user.status === "failed") {
      return;
    }

    existing.createdAt = user.createdAt;
    existing.description = user.description;
    existing.profileImageURL = user.profileImageURL;
    existing.userInfoStatus = user.status;
  });
}

function ensureUserInfoDrain(session: ChannelSession): void {
  if (session.enrichmentPromise || session.pendingUsernames.size === 0) {
    return;
  }

  session.enrichmentPromise = (async () => {
    while (session.pendingUsernames.size > 0) {
      const batch = Array.from(session.pendingUsernames).slice(0, USER_INFO_DRAIN_BATCH_SIZE);
      const userInfo = await getUserInfoGraphQL(batch);
      applyUserInfoToSession(session, userInfo);
      const completedUsernames = userInfo.filter((user) => user.status !== "failed").map((user) => user.username);
      completedUsernames.forEach((username) => session.pendingUsernames.delete(username));
      if (completedUsernames.length === 0) {
        break;
      }
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      session.enrichmentPromise = undefined;
    });
}

function monthKeyFromDate(value: string): string {
  return value.split("T")[0].slice(0, 7);
}

function dayKeyFromDate(value: string): string {
  return value.split("T")[0];
}

function buildAccountCreationCounts(viewers: SessionViewer[]) {
  const monthlyCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();

  for (const viewer of viewers) {
    if (!viewer.createdAt) {
      continue;
    }

    const monthKey = monthKeyFromDate(viewer.createdAt);
    const dayKey = dayKeyFromDate(viewer.createdAt);
    monthlyCounts.set(monthKey, (monthlyCounts.get(monthKey) || 0) + 1);
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
  }

  return { monthlyCounts, dayCounts };
}

function calculateBaselineStats(monthlyCounts: Map<string, number>, startDate: Date) {
  let totalPostStartAccounts = 0;
  let totalPostStartMonths = 0;
  const postStartMonths: Array<{ monthKey: string; count: number }> = [];

  for (const [monthKey, count] of monthlyCounts.entries()) {
    const monthDate = new Date(`${monthKey}-01T00:00:00Z`);
    if (monthDate < startDate) {
      continue;
    }

    totalPostStartAccounts += count;
    totalPostStartMonths += 1;
    postStartMonths.push({ monthKey, count });
  }

  let totalPostStartAccountsExcludingTopx = totalPostStartAccounts;
  let totalPostStartMonthsExcludingTopx = totalPostStartMonths;
  const monthsToIgnore = totalPostStartMonths < 20 ? 5 : 10;

  if (postStartMonths.length > monthsToIgnore) {
    const sortedMonths = [...postStartMonths].sort((left, right) => right.count - left.count);
    const topxTotal = sortedMonths.slice(0, monthsToIgnore).reduce((sum, month) => sum + month.count, 0);
    totalPostStartAccountsExcludingTopx = totalPostStartAccounts - topxTotal;
    totalPostStartMonthsExcludingTopx = totalPostStartMonths - monthsToIgnore;
  }

  return {
    totalPostStartAccountsExcludingTopx,
    totalPostStartMonthsExcludingTopx,
  };
}

function calculateMaxExpectedAccounts(totalPostStartMonthsExcludingTopx: number, totalPostStartAccountsExcludingTopx: number) {
  if (totalPostStartMonthsExcludingTopx <= 5) {
    return 5;
  }

  const maxExpected = Math.ceil((totalPostStartAccountsExcludingTopx / totalPostStartMonthsExcludingTopx) * 5);
  return Number.isFinite(maxExpected) && maxExpected > 0 ? Math.max(maxExpected, 5) : 5;
}

function calculateBotCounts(monthlyCounts: Map<string, number>, startDate: Date, maxExpectedAccounts: number) {
  let totalBots = 0;
  const monthData: Array<{ month: string; nonBots: number; bots: number }> = [];
  const now = new Date();
  const botStartDate = new Date(BOT_DATE_RANGE_START);
  const twelveMonthsAfterStart = new Date(botStartDate);
  twelveMonthsAfterStart.setMonth(twelveMonthsAfterStart.getMonth() + 12);

  for (const [monthKey, count] of monthlyCounts.entries()) {
    const monthDate = new Date(`${monthKey}-01T00:00:00Z`);
    if (monthDate < startDate) {
      continue;
    }

    const monthAge = (now.getFullYear() - monthDate.getFullYear()) * 12 + (now.getMonth() - monthDate.getMonth());
    let thresholdMultiplier = 1;

    if (monthDate >= botStartDate && monthDate < twelveMonthsAfterStart) {
      thresholdMultiplier = 1.5;
    } else if (monthAge < 3) {
      thresholdMultiplier = 2;
    } else if (monthAge < 6) {
      thresholdMultiplier = 1.5;
    } else if (monthAge < 9) {
      thresholdMultiplier = 1.25;
    }

    const adjustedThreshold = maxExpectedAccounts * thresholdMultiplier;
    let bots = Math.max(0, count - adjustedThreshold);
    if (bots > 0) {
      bots = Math.max(0, count - adjustedThreshold / 3);
    }

    const roundedBots = Math.round(bots);
    totalBots += roundedBots;
    monthData.push({
      month: monthKey,
      nonBots: Math.round(count - bots),
      bots: roundedBots,
    });
  }

  return { totalBots, monthData };
}

function analyzeViewers(viewersMap: Map<string, SessionViewer>, streamLive = true) {
  const viewers = Array.from(viewersMap.values());
  const viewersWithDates = viewers.filter((viewer) => viewer.createdAt);
  const { monthlyCounts, dayCounts } = buildAccountCreationCounts(viewers);
  const baselineStats = calculateBaselineStats(monthlyCounts, new Date(BOT_DATE_RANGE_START));
  const maxExpectedAccounts = calculateMaxExpectedAccounts(
    baselineStats.totalPostStartMonthsExcludingTopx,
    baselineStats.totalPostStartAccountsExcludingTopx,
  );
  const botCounts = calculateBotCounts(monthlyCounts, new Date(BOT_DATE_RANGE_START), maxExpectedAccounts);
  const botPercentage = viewersWithDates.length ? botCounts.totalBots / viewersWithDates.length : 0;
  const monthFlags = new Map(
    (botPercentage >= 0.1 ? botCounts.monthData : [])
      .filter((item) => item.bots > 0)
      .map((item) => [item.month, item]),
  );

  const analyzed = viewers.map((viewer) => {
    const tags: ScoreTag[] = [];
    const scoreBreakdown: ScoreContribution[] = [];
    let score = 0;
    const addScore = (id: string, label: string, points: number, detail: string) => {
      if (points <= 0) {
        return;
      }

      score += points;
      scoreBreakdown.push({ id, label, points, detail });
    };

    viewer.accountsOnSameDay = viewer.createdAt ? dayCounts.get(dayKeyFromDate(viewer.createdAt)) || 0 : 0;
    viewer.watchTimeMinutes = Math.max(0, Math.round((viewer.lastSeen - viewer.firstSeen) / 60000));

    if (viewer.userInfoStatus === "resolved" && !viewer.createdAt) {
      tags.push("missing_created_at");
      addScore("missing_created_at", "No creation date", 3, "The profile resolved, but Twitch did not expose an account creation date.");
    } else if (viewer.createdAt) {
      const createdAt = new Date(viewer.createdAt);
      const ageDays = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
      const monthInfo = monthFlags.get(monthKeyFromDate(viewer.createdAt));

      if (ageDays < 30) {
        tags.push("new_account");
        addScore("new_account_30d", "Very new account", 26, `Account age is ${ageDays} days, which is unusually fresh for a sampled viewer.`);
      } else if (ageDays < 90) {
        tags.push("new_account");
        addScore("new_account_90d", "New account", 14, `Account age is ${ageDays} days, so it still falls in a newer-account risk band.`);
      }

      if (monthInfo) {
        tags.push("clustered_creation");
        const monthRatio = monthInfo.bots / Math.max(monthInfo.nonBots + monthInfo.bots, 1);
        const monthPoints = monthRatio >= 0.5 ? 24 : monthRatio >= 0.25 ? 16 : 10;
        addScore(
          "clustered_creation",
          "Creation cluster",
          monthPoints,
          `${monthInfo.bots} sampled accounts from ${monthKeyFromDate(viewer.createdAt)} sit in a high-density creation bucket.`,
        );
      }

      if (viewer.accountsOnSameDay >= 5) {
        tags.push("same_day_cluster");
        const dayClusterPoints = Math.min(12, (viewer.accountsOnSameDay - 4) * 2);
        addScore(
          "same_day_cluster",
          "Same-day cluster",
          dayClusterPoints,
          `${viewer.accountsOnSameDay} sampled accounts share this exact account creation day.`,
        );
      }
    }

    if (viewer.userInfoStatus === "resolved" && !viewer.description) {
      tags.push("no_description");
      addScore("no_description", "No bio", 4, "The account has no profile description, which is a weak but useful signal when stacked.");
    }

    if (viewer.userInfoStatus === "resolved" && isDefaultProfileImageURL(viewer.profileImageURL)) {
      tags.push("default_avatar");
      addScore("default_avatar", "Default avatar", 4, "The profile image still matches Twitch's default avatar set, which is a small unfinished-profile signal.");
    }

    if (viewer.watchTimeMinutes < 5) {
      tags.push("short_watch");
      addScore("short_watch", "Short watch", 4, `Sentio has only seen this account for ${viewer.watchTimeMinutes} minute${viewer.watchTimeMinutes === 1 ? "" : "s"} so far.`);
    }

    if (tags.includes("new_account") && tags.includes("no_description")) {
      addScore("combo_new_no_bio", "New account + no bio", 6, "A fresh account without a bio is more notable than either signal alone.");
    }

    if (tags.includes("new_account") && tags.includes("short_watch")) {
      addScore("combo_new_short_watch", "New account + short watch", 6, "New accounts that barely stay visible deserve a closer look.");
    }

    if (tags.includes("new_account") && tags.includes("same_day_cluster")) {
      addScore("combo_new_day_cluster", "New account + day cluster", 8, "A new account that lands inside a same-day creation cluster is more concerning in context.");
    }

    if (tags.includes("clustered_creation") && tags.includes("same_day_cluster")) {
      addScore("combo_cluster_stack", "Creation cluster stack", 10, "Both the monthly creation bucket and the exact day cluster lean in the same direction.");
    }

    if (tags.includes("clustered_creation") && tags.includes("short_watch")) {
      addScore("combo_cluster_short_watch", "Cluster + short watch", 6, "A clustered account with very short watch-time stacks multiple weak signals.");
    }

    return {
      ...viewer,
      displayName: viewer.username,
      score: Math.max(0, Math.min(100, score)),
      tags,
      scoreBreakdown,
      present: streamLive && Date.now() - viewer.lastSeen < 120_000,
    } satisfies Viewer;
  });

  analyzed.sort((left, right) => right.score - left.score || right.watchTimeMinutes - left.watchTimeMinutes || left.username.localeCompare(right.username));

  return {
    viewers: analyzed,
    suspiciousCount: analyzed.filter((viewer) => scoreBand(viewer.score) === "suspicious").length,
    watchCount: analyzed.filter((viewer) => scoreBand(viewer.score) === "watch").length,
    safeCount: analyzed.filter((viewer) => scoreBand(viewer.score) === "safe").length,
    newAccountCount: analyzed.filter((viewer) => viewer.tags.includes("new_account")).length,
    pendingCount: analyzed.filter((viewer) => !viewer.createdAt).length,
  };
}

function getTrackedHistoryMinutes(history: ChannelSession["history"]): number {
  if (history.length < 2) {
    return 0;
  }

  return Math.max(0, (history[history.length - 1].timestamp - history[0].timestamp) / 60000);
}

function buildChannelRemarks(viewers: Viewer[], liveViewerCount: number, trackedMinutes: number): ChannelRemark[] {
  const presentViewers = viewers.filter((viewer) => viewer.present);
  const shortWatchPresent = presentViewers.filter((viewer) => viewer.watchTimeMinutes < 5).length;
  const suspiciousPresent = presentViewers.filter((viewer) => scoreBand(viewer.score) === "suspicious").length;

  if (trackedMinutes < LURKER_REMARK_MIN_TRACKING_MINUTES || liveViewerCount < 75 || presentViewers.length < 40) {
    return [];
  }

  const shortWatchRatio = shortWatchPresent / Math.max(presentViewers.length, 1);
  const suspiciousRatio = suspiciousPresent / Math.max(presentViewers.length, 1);

  if (shortWatchRatio >= 0.65 && suspiciousRatio <= 0.3) {
    return [
      {
        id: "lurker-heavy",
        title: "Lurker-heavy audience",
        description:
          "Many recently seen viewers still have short watch-time. On slower chats this can simply mean a quiet, lurker-heavy audience rather than a strong bot signal.",
        tone: "note",
      },
    ];
  }

  return [];
}

function upsertTimeline(session: ChannelSession, liveViewerCount: number, suspiciousCount: number, authenticatedCount: number) {
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

function mapTimeline(history: ChannelSession["history"]): { points: TimelinePoint[]; spanMinutes: number; resolutionMinutes: number } {
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
    points: bucketed.map((point) => {
      return {
        t: formatClockTime(point.timestamp),
        viewers: point.viewers,
        suspicious: point.suspicious,
        authenticated: point.authenticated,
      };
    }),
  };
}

function applyLiveViewerCountOverride(session: ChannelSession, viewerCountText?: string): ChannelSnapshot | undefined {
  if (!session.latestSnapshot) {
    return undefined;
  }

  if (!session.latestSnapshot.streamLive) {
    return session.latestSnapshot;
  }

  const liveViewerCount = parseCompactNumber(viewerCountText);
  if (liveViewerCount === null || liveViewerCount === session.latestSnapshot.liveViewerCount) {
    return session.latestSnapshot;
  }

  const latest = session.history[session.history.length - 1];
  const now = Date.now();
  const bucketTimestamp = now - (now % 60000);
  if (latest && latest.timestamp === bucketTimestamp) {
    latest.viewers = liveViewerCount;
  }

  const snapshot: ChannelSnapshot = {
    ...session.latestSnapshot,
    liveViewerCount,
    updatedAt: Date.now(),
    timeline: [],
    timelineSpanMinutes: 0,
    timelineResolutionMinutes: 1,
    remarks: buildChannelRemarks(session.latestSnapshot.viewers, liveViewerCount, getTrackedHistoryMinutes(session.history)),
  };

  const timeline = mapTimeline(session.history);
  snapshot.timeline = timeline.points;
  snapshot.timelineSpanMinutes = timeline.spanMinutes;
  snapshot.timelineResolutionMinutes = timeline.resolutionMinutes;

  session.latestSnapshot = snapshot;
  return snapshot;
}

async function refreshChannelSnapshot(context: DashboardContext): Promise<{ snapshot: ChannelSnapshot | null; recentChannels: Channel[] }> {
  if (!context.channelName) {
    return { snapshot: null, recentChannels: getActiveChannels() };
  }

  const session = ensureSession(context.channelName, context.channelGame, context.channelAvatarColor);
  const now = Date.now();

  if (session.latestSnapshot && now - session.lastFetchedAt < SNAPSHOT_TTL_MS) {
    const snapshot = applyLiveViewerCountOverride(session, context.viewerCount) ?? session.latestSnapshot;
    await storeContext(resolveDashboardContext(context, session, snapshot));
    return { snapshot, recentChannels: getActiveChannels() };
  }

  if (session.refreshPromise) {
    const snapshot = await session.refreshPromise;
    const resolvedSnapshot = applyLiveViewerCountOverride(session, context.viewerCount) ?? snapshot;
    await storeContext(resolveDashboardContext(context, session, resolvedSnapshot));
    return { snapshot: resolvedSnapshot, recentChannels: getActiveChannels() };
  }

  session.refreshPromise = (async () => {
    const liveViewerCount = await getViewerCount(context.channelName!);
    const seenAt = Date.now();

    if (liveViewerCount <= 0) {
      const analyzed = analyzeViewers(session.viewers, false);
      upsertTimeline(session, 0, 0, 0);

      const snapshot: ChannelSnapshot = {
        channel: session.channel,
        streamLive: false,
        liveViewerCount: 0,
        authenticatedCount: 0,
        sampledCount: analyzed.viewers.length,
        suspiciousCount: analyzed.suspiciousCount,
        watchCount: analyzed.watchCount,
        safeCount: analyzed.safeCount,
        newAccountCount: analyzed.newAccountCount,
        pendingCount: 0,
        updatedAt: Date.now(),
        viewers: analyzed.viewers,
        timeline: [],
        timelineSpanMinutes: 0,
        timelineResolutionMinutes: 1,
        remarks: [],
      };

      const timeline = mapTimeline(session.history);
      snapshot.timeline = timeline.points;
      snapshot.timelineSpanMinutes = timeline.spanMinutes;
      snapshot.timelineResolutionMinutes = timeline.resolutionMinutes;

      session.latestSnapshot = snapshot;
      session.lastFetchedAt = Date.now();
      return snapshot;
    }

    if (session.latestSnapshot && !session.latestSnapshot.streamLive) {
      session.viewers.clear();
      session.pendingUsernames.clear();
      session.history = [];
      session.latestSnapshot = undefined;
    }

    const viewerSample = await getViewerListParallel(context.channelName!, VIEWER_SAMPLE_CONCURRENT_CALLS);

    viewerSample.viewers.forEach((username) => {
      const existing = session.viewers.get(username);
      if (existing) {
        existing.lastSeen = seenAt;
        return;
      }

      session.viewers.set(username, {
        id: username,
        username,
        createdAt: null,
        description: null,
        profileImageURL: null,
        userInfoStatus: "pending",
        firstSeen: seenAt,
        lastSeen: seenAt,
        watchTimeMinutes: 0,
        accountsOnSameDay: 0,
        score: 0,
        tags: [],
      });
      session.pendingUsernames.add(username);
    });

    const pendingUsers = Array.from(session.pendingUsernames);
    const pendingCount = pendingUsers.length;

    if (!session.channel.profileImageURL || session.channel.displayName === session.channel.name) {
      const [channelInfo] = await getUserInfoGraphQL([context.channelName!]);
      if (channelInfo) {
        session.channel = {
          ...session.channel,
          displayName: channelInfo.displayName || session.channel.displayName,
          profileImageURL: channelInfo.profileImageURL || session.channel.profileImageURL,
        };
      }
    }

    ensureUserInfoDrain(session);

    const analyzed = analyzeViewers(session.viewers, true);
    upsertTimeline(session, liveViewerCount, analyzed.suspiciousCount, viewerSample.totalAuthenticatedCount);

    const snapshot: ChannelSnapshot = {
      channel: session.channel,
      streamLive: true,
      liveViewerCount,
      authenticatedCount: viewerSample.totalAuthenticatedCount,
      sampledCount: analyzed.viewers.length,
      suspiciousCount: analyzed.suspiciousCount,
      watchCount: analyzed.watchCount,
      safeCount: analyzed.safeCount,
      newAccountCount: analyzed.newAccountCount,
      pendingCount,
      updatedAt: Date.now(),
      viewers: analyzed.viewers,
      timeline: [],
      timelineSpanMinutes: 0,
      timelineResolutionMinutes: 1,
      remarks: buildChannelRemarks(analyzed.viewers, liveViewerCount, getTrackedHistoryMinutes(session.history)),
    };

    const timeline = mapTimeline(session.history);
    snapshot.timeline = timeline.points;
    snapshot.timelineSpanMinutes = timeline.spanMinutes;
    snapshot.timelineResolutionMinutes = timeline.resolutionMinutes;

    session.latestSnapshot = snapshot;
    session.lastFetchedAt = Date.now();
    return applyLiveViewerCountOverride(session, context.viewerCount) ?? snapshot;
  })();

  try {
    const snapshot = await session.refreshPromise;
    await storeContext(resolveDashboardContext(context, session, snapshot));
    return { snapshot, recentChannels: getActiveChannels() };
  } finally {
    session.refreshPromise = undefined;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!isTwitchChannelUrl(tab.url)) {
    return;
  }

  await openDashboard(await buildDashboardContextFromTab(tab));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => updateActionState(tabId, tab.url))
    .catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const nextUrl = changeInfo.url || tab.url;
  if (nextUrl) {
    updateActionState(tabId, nextUrl).catch(() => undefined);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    refreshActiveTabActionState().catch(() => undefined);
  }
});

chrome.runtime.onStartup.addListener(() => {
  refreshActiveTabActionState().catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  refreshActiveTabActionState().catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    sendResponse({ success: false, error: "Invalid message" });
    return false;
  }

  const payload = message as { type: string; payload?: DashboardContext };

  if (payload.type === "OPEN_DASHBOARD") {
    openDashboard(payload.payload)
      .then((result) => sendResponse(result))
      .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (payload.type === "GET_LAST_DASHBOARD_CONTEXT") {
    getStoredContext()
      .then((context) => sendResponse({ success: true, context }))
      .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (payload.type === "GET_CHANNEL_LIVE_STATUS") {
    const channelName = payload.payload?.channelName;
    if (!channelName) {
      sendResponse({ success: false, error: "Missing channel name" });
      return false;
    }

    getViewerCount(channelName)
      .then((liveViewerCount) =>
        sendResponse({
          success: true,
          streamLive: liveViewerCount > 0,
          liveViewerCount,
        }),
      )
      .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (payload.type === "GET_CHANNEL_ANALYTICS") {
    refreshChannelSnapshot(payload.payload || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  sendResponse({ success: false, error: "Unknown message type" });
  return false;
});
