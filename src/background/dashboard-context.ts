import { DASHBOARD_PAGE, DASHBOARD_STORAGE_KEY, EXPERIMENTAL_SETTINGS_STORAGE_KEY, type DashboardChannel, type DashboardContext, type ExperimentalSettings } from "../shared/extension";
import { type Channel, type ChannelSnapshot } from "../shared/analytics";
import { type ChannelSession, getActiveChannels, sessions } from "./session-types";

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

export async function getStoredContext(): Promise<DashboardContext | undefined> {
  const result = await chrome.storage.local.get([DASHBOARD_STORAGE_KEY]);
  return result[DASHBOARD_STORAGE_KEY] as DashboardContext | undefined;
}

export async function getExperimentalSettings(): Promise<ExperimentalSettings | undefined> {
  const result = await chrome.storage.local.get([EXPERIMENTAL_SETTINGS_STORAGE_KEY]);
  return result[EXPERIMENTAL_SETTINGS_STORAGE_KEY] as ExperimentalSettings | undefined;
}

export async function buildDashboardContextFromTab(tab?: chrome.tabs.Tab): Promise<DashboardContext> {
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
    viewerCount: session?.latestSnapshot?.liveViewerCount?.toString() || storedMatch?.viewerCount || "",
  };
}

export function buildDashboardUrl(context: DashboardContext = {}): string {
  const url = new URL(chrome.runtime.getURL(DASHBOARD_PAGE));

  if (context.channelName) {
    url.searchParams.set("channel", context.channelName);
  }

  if (context.viewerCount) {
    url.searchParams.set("viewers", context.viewerCount);
  }

  return url.toString();
}

export function resolveDashboardContext(context: DashboardContext, session?: ChannelSession, snapshot?: ChannelSnapshot | null): DashboardContext {
  const channel = snapshot?.channel ?? session?.channel;

  return {
    ...context,
    channelName: context.channelName || channel?.name || "",
    channelDisplayName: channel?.displayName || context.channelDisplayName || context.channelName || "",
    channelGame: channel?.game || context.channelGame || "Live channel",
    channelAvatarColor: channel?.avatarColor || context.channelAvatarColor || "",
    channelProfileImageURL: channel?.profileImageURL ?? context.channelProfileImageURL ?? null,
    viewerCount: context.viewerCount || snapshot?.liveViewerCount?.toString() || session?.latestSnapshot?.liveViewerCount?.toString() || "",
  };
}

export async function storeContext(context: DashboardContext = {}): Promise<void> {
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

async function findDashboardTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  const dashboardPrefix = chrome.runtime.getURL(DASHBOARD_PAGE);
  return tabs.find((tab) => typeof tab.url === "string" && tab.url.startsWith(dashboardPrefix));
}

export async function openDashboard(context: DashboardContext = {}): Promise<{ success: true; tabId?: number }> {
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

export function getChannelNameFromUrl(url?: string): string | undefined {
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

export function isTwitchChannelUrl(url?: string): boolean {
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

export { getActiveChannels };

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
