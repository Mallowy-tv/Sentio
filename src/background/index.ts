import {
  buildChannel,
  parseCompactNumber,
  scoreBand,
  type Channel,
  type ChannelSnapshot,
  type ScoreTag,
  type TimelinePoint,
  type Viewer,
} from "../shared/analytics";
import { DASHBOARD_PAGE, DASHBOARD_STORAGE_KEY, type DashboardChannel, type DashboardContext } from "../shared/extension";
import { getUserInfoGraphQL, getViewerCount, getViewerListParallel } from "./twitchApi";

type SessionViewer = Omit<Viewer, "present" | "displayName">;

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

    existing.createdAt = user.createdAt;
    existing.description = user.description;
    existing.profileImageURL = user.profileImageURL;
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
      batch.forEach((username) => session.pendingUsernames.delete(username));
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      session.enrichmentPromise = undefined;
      if (session.pendingUsernames.size > 0) {
        ensureUserInfoDrain(session);
      }
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

function analyzeViewers(viewersMap: Map<string, SessionViewer>) {
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
    let score = 0;

    viewer.accountsOnSameDay = viewer.createdAt ? dayCounts.get(dayKeyFromDate(viewer.createdAt)) || 0 : 0;
    viewer.watchTimeMinutes = Math.max(0, Math.round((viewer.lastSeen - viewer.firstSeen) / 60000));

    if (!viewer.createdAt) {
      tags.push("missing_created_at");
      score += 8;
    } else {
      const createdAt = new Date(viewer.createdAt);
      const ageDays = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
      const monthInfo = monthFlags.get(monthKeyFromDate(viewer.createdAt));

      if (ageDays < 30) {
        tags.push("new_account");
        score += 35;
      } else if (ageDays < 90) {
        tags.push("new_account");
        score += 18;
      }

      if (monthInfo) {
        tags.push("clustered_creation");
        const monthRatio = monthInfo.bots / Math.max(monthInfo.nonBots + monthInfo.bots, 1);
        score += monthRatio >= 0.5 ? 40 : monthRatio >= 0.25 ? 28 : 18;
      }

      if (viewer.accountsOnSameDay >= 5) {
        tags.push("same_day_cluster");
        score += Math.min(24, (viewer.accountsOnSameDay - 4) * 3);
      }
    }

    if (!viewer.description) {
      tags.push("no_description");
      score += 10;
    }

    if (viewer.watchTimeMinutes < 5) {
      tags.push("short_watch");
      score += 10;
    }

    return {
      ...viewer,
      displayName: viewer.username,
      score: Math.max(0, Math.min(100, score)),
      tags,
      present: Date.now() - viewer.lastSeen < 120_000,
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
      const stamp = new Date(point.timestamp);
      return {
        t: `${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}`,
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

  await storeContext(context);
  const session = ensureSession(context.channelName, context.channelGame, context.channelAvatarColor);
  const now = Date.now();

  if (session.latestSnapshot && now - session.lastFetchedAt < SNAPSHOT_TTL_MS) {
    return { snapshot: applyLiveViewerCountOverride(session, context.viewerCount) ?? session.latestSnapshot, recentChannels: getActiveChannels() };
  }

  if (session.refreshPromise) {
    const snapshot = await session.refreshPromise;
    return { snapshot: applyLiveViewerCountOverride(session, context.viewerCount) ?? snapshot, recentChannels: getActiveChannels() };
  }

  session.refreshPromise = (async () => {
    const [liveViewerCountRaw, viewerSample] = await Promise.all([
      getViewerCount(context.channelName!),
      getViewerListParallel(context.channelName!, VIEWER_SAMPLE_CONCURRENT_CALLS),
    ]);

    const fallbackViewerCount = parseCompactNumber(context.viewerCount);
    const liveViewerCount = liveViewerCountRaw || fallbackViewerCount || session.latestSnapshot?.liveViewerCount || 0;
    const seenAt = Date.now();

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

    const analyzed = analyzeViewers(session.viewers);
    upsertTimeline(session, liveViewerCount, analyzed.suspiciousCount, viewerSample.totalAuthenticatedCount);

  const snapshot: ChannelSnapshot = {
      channel: session.channel,
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
    return { snapshot: await session.refreshPromise, recentChannels: getActiveChannels() };
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

  if (payload.type === "GET_CHANNEL_ANALYTICS") {
    refreshChannelSnapshot(payload.payload || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error: Error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  sendResponse({ success: false, error: "Unknown message type" });
  return false;
});
