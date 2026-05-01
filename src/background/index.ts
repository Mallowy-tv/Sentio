import {
  formatClockTime,
  isDefaultProfileImageURL,
  parseCompactNumber,
  type Channel,
  type ChannelSnapshot,
} from "../shared/analytics";
import { type DashboardContext } from "../shared/extension";
import { getUserInfoGraphQL, getViewerCount, getViewerListParallel } from "./twitchApi";
import { buildDashboardContextFromTab, getExperimentalSettings, getStoredContext, getActiveChannels, isTwitchChannelUrl, openDashboard, resolveDashboardContext, storeContext } from "./dashboard-context";
import { clearChannelSession, ensureSession, type ChannelSession, type SessionViewer } from "./session-types";
import {
  VIEWER_REAPPEAR_EVENT_GAP_MS,
  appendViewerEvent,
  describeProfileImageState,
  describeViewerScoreBand,
  formatTagLabels,
  formatViewerEventMinutes,
  normalizeSnapshotViewerEvents,
  normalizeViewerDescription,
  normalizeViewerEvents,
  summarizeViewerDescription,
} from "./viewer-events";
import { analyzeViewers, buildChannelRemarks, getTrackedHistoryMinutes } from "./viewer-scoring";
import { mapTimeline, upsertTimeline } from "./timeline";

const SNAPSHOT_TTL_MS = 5_000;
const VIEWER_SAMPLE_CONCURRENT_CALLS = 20;
const USER_INFO_DRAIN_BATCH_SIZE = 200;
const ACTION_ENABLED_TITLE = "Open Sentio dashboard";
const ACTION_DISABLED_TITLE = "Sentio is only available on Twitch channel pages";

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

function applyUserInfoToSession(session: ChannelSession, userInfo: Awaited<ReturnType<typeof getUserInfoGraphQL>>) {
  userInfo.forEach((user) => {
    const existing = session.viewers.get(user.username);
    if (!existing) {
      return;
    }

    if (user.status === "failed") {
      return;
    }

    const previousStatus = existing.userInfoStatus;
    const previousCreatedAt = existing.createdAt;
    const previousDescription = normalizeViewerDescription(existing.description);
    const previousAvatarState = describeProfileImageState(existing.profileImageURL);

    existing.createdAt = user.createdAt;
    existing.description = user.description;
    existing.profileImageURL = user.profileImageURL;
    existing.userInfoStatus = user.status;

    const nextDescription = normalizeViewerDescription(existing.description);
    const nextAvatarState = describeProfileImageState(existing.profileImageURL);
    const detailParts: string[] = [];

    if (previousCreatedAt !== existing.createdAt) {
      detailParts.push(existing.createdAt ? `Created ${new Date(existing.createdAt).toLocaleDateString()}` : "Creation date unavailable");
    }

    if (previousDescription !== nextDescription) {
      if (nextDescription) {
        detailParts.push(`Bio: "${summarizeViewerDescription(nextDescription)}"`);
      } else {
        detailParts.push("Bio empty");
      }
    }

    if (previousAvatarState !== nextAvatarState) {
      detailParts.push(`Avatar: ${nextAvatarState}`);
    }

    if (previousStatus !== existing.userInfoStatus) {
      const title = existing.userInfoStatus === "resolved" ? "Profile resolved" : "Profile unavailable";
      appendViewerEvent(session, existing, {
        at: Date.now(),
        kind: "profile",
        title,
        detail:
          detailParts.join(" · ") ||
          (existing.userInfoStatus === "resolved"
            ? "Profile details became available from Twitch."
            : "Twitch did not return profile details for this account."),
      });
      return;
    }

    if (detailParts.length > 0) {
      appendViewerEvent(session, existing, {
        at: Date.now(),
        kind: "profile",
        title: "Profile updated",
        detail: detailParts.join(" · "),
      });
    }
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

function applyLiveViewerCountOverride(
  session: ChannelSession,
  viewerCountText?: string,
  enhancedDetectionSignals = false,
): ChannelSnapshot | undefined {
  if (!session.latestSnapshot) {
    return undefined;
  }

  if (!session.latestSnapshot.streamLive) {
    return normalizeSnapshotViewerEvents(session.latestSnapshot);
  }

  const liveViewerCount = parseCompactNumber(viewerCountText);
  if (liveViewerCount === null || liveViewerCount === session.latestSnapshot.liveViewerCount) {
    return normalizeSnapshotViewerEvents(session.latestSnapshot);
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
    remarks: buildChannelRemarks(
      session.latestSnapshot.viewers,
      liveViewerCount,
      getTrackedHistoryMinutes(session.history),
      session.latestSnapshot.authenticatedCount,
      enhancedDetectionSignals,
    ),
  };

  const timeline = mapTimeline(session.history);
  snapshot.timeline = timeline.points;
  snapshot.timelineSpanMinutes = timeline.spanMinutes;
  snapshot.timelineResolutionMinutes = timeline.resolutionMinutes;

  session.latestSnapshot = snapshot;
  session.lastExperimentalSignalsEnabled = enhancedDetectionSignals;
  return normalizeSnapshotViewerEvents(snapshot);
}

async function refreshChannelSnapshot(context: DashboardContext): Promise<{ snapshot: ChannelSnapshot | null; recentChannels: Channel[] }> {
  if (!context.channelName) {
    return { snapshot: null, recentChannels: getActiveChannels() };
  }

  const experimentalSettings = await getExperimentalSettings();
  const enhancedDetectionSignals = experimentalSettings?.enhancedDetectionSignals === true;
  const session = ensureSession(context.channelName, context.channelGame, context.channelAvatarColor);
  const now = Date.now();
  const canReuseSnapshot =
    session.latestSnapshot &&
    now - session.lastFetchedAt < SNAPSHOT_TTL_MS &&
    session.lastExperimentalSignalsEnabled === enhancedDetectionSignals;

  if (canReuseSnapshot) {
    const snapshot = applyLiveViewerCountOverride(session, context.viewerCount, enhancedDetectionSignals) ?? session.latestSnapshot!;
    await storeContext(resolveDashboardContext(context, session, snapshot));
    return { snapshot, recentChannels: getActiveChannels() };
  }

  if (session.refreshPromise) {
    const snapshot = await session.refreshPromise;
    const resolvedSnapshot = applyLiveViewerCountOverride(session, context.viewerCount, enhancedDetectionSignals) ?? snapshot;
    await storeContext(resolveDashboardContext(context, session, resolvedSnapshot));
    return { snapshot: resolvedSnapshot, recentChannels: getActiveChannels() };
  }

  session.refreshPromise = (async () => {
    const liveViewerCount = await getViewerCount(context.channelName!);
    const seenAt = Date.now();

    if (liveViewerCount <= 0) {
      const analyzed = analyzeViewers(session, false, enhancedDetectionSignals);
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
      session.lastExperimentalSignalsEnabled = enhancedDetectionSignals;
      session.lastFetchedAt = Date.now();
      return snapshot;
    }

    if (session.latestSnapshot && !session.latestSnapshot.streamLive) {
      session.viewers.clear();
      session.pendingUsernames.clear();
      session.history = [];
      session.nextViewerEventId = 1;
      session.latestSnapshot = undefined;
    }

    const viewerSample = await getViewerListParallel(context.channelName!, VIEWER_SAMPLE_CONCURRENT_CALLS);

    viewerSample.viewers.forEach((username) => {
      const existing = session.viewers.get(username);
      if (existing) {
        const gapMinutes = Math.max(0, Math.round((seenAt - existing.lastSeen) / 60000));
        if (seenAt - existing.lastSeen >= VIEWER_REAPPEAR_EVENT_GAP_MS) {
          appendViewerEvent(session, existing, {
            at: seenAt,
            kind: "sample",
            title: "Seen again",
            detail: `The account reappeared after ${formatViewerEventMinutes(gapMinutes)} away from the sampled set.`,
          });
        }
        existing.lastSeen = seenAt;
        return;
      }

      const nextViewer: SessionViewer = {
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
        events: [],
      };
      appendViewerEvent(session, nextViewer, {
        at: seenAt,
        kind: "sample",
        title: "First seen",
        detail: "Added to the sampled viewer set for this channel session.",
      });
      session.viewers.set(username, nextViewer);
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

    const analyzed = analyzeViewers(session, true, enhancedDetectionSignals);
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
      remarks: buildChannelRemarks(
        analyzed.viewers,
        liveViewerCount,
        getTrackedHistoryMinutes(session.history),
        viewerSample.totalAuthenticatedCount,
        enhancedDetectionSignals,
      ),
    };

    const timeline = mapTimeline(session.history);
    snapshot.timeline = timeline.points;
    snapshot.timelineSpanMinutes = timeline.spanMinutes;
    snapshot.timelineResolutionMinutes = timeline.resolutionMinutes;

    session.latestSnapshot = snapshot;
    session.lastExperimentalSignalsEnabled = enhancedDetectionSignals;
    session.lastFetchedAt = Date.now();
    return applyLiveViewerCountOverride(session, context.viewerCount, enhancedDetectionSignals) ?? snapshot;
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

  if (payload.type === "CLEAR_CHANNEL_SESSION") {
    const channelName = payload.payload?.channelName;
    if (!channelName) {
      sendResponse({ success: false, error: "Missing channel name" });
      return false;
    }

    clearChannelSession(channelName);
    sendResponse({ success: true });
    return false;
  }

  sendResponse({ success: false, error: "Unknown message type" });
  return false;
});
