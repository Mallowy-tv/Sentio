import type { Channel, ChannelSnapshot } from "./analytics";
import type { DashboardContext } from "./extension";

type AnalyticsResponse = {
  success: boolean;
  snapshot?: ChannelSnapshot | null;
  recentChannels?: Channel[];
  error?: string;
};

type LiveStatusResponse = {
  success: boolean;
  streamLive?: boolean;
  liveViewerCount?: number;
  error?: string;
};

function getRuntime(): typeof chrome.runtime | null {
  const runtime = globalThis.chrome?.runtime;
  return runtime?.id ? runtime : null;
}

export async function requestChannelAnalytics(context: DashboardContext): Promise<{ snapshot: ChannelSnapshot | null; recentChannels: Channel[] }> {
  const runtime = getRuntime();
  if (!runtime) {
    throw new Error("Sentio runtime unavailable");
  }

  const response = (await runtime.sendMessage({
    type: "GET_CHANNEL_ANALYTICS",
    payload: context,
  })) as AnalyticsResponse;

  if (!response.success) {
    throw new Error(response.error || "Failed to load analytics");
  }

  return {
    snapshot: response.snapshot ?? null,
    recentChannels: response.recentChannels ?? [],
  };
}

export async function warmChannelAnalytics(context: DashboardContext): Promise<void> {
  const runtime = getRuntime();
  if (!runtime) {
    return;
  }

  await runtime.sendMessage({
    type: "GET_CHANNEL_ANALYTICS",
    payload: context,
  });
}

export async function requestChannelLiveStatus(channelName: string): Promise<{ streamLive: boolean; liveViewerCount: number }> {
  const runtime = getRuntime();
  if (!runtime) {
    throw new Error("Sentio runtime unavailable");
  }

  const response = (await runtime.sendMessage({
    type: "GET_CHANNEL_LIVE_STATUS",
    payload: { channelName },
  })) as LiveStatusResponse;

  if (!response.success) {
    throw new Error(response.error || "Failed to load live status");
  }

  return {
    streamLive: response.streamLive ?? false,
    liveViewerCount: response.liveViewerCount ?? 0,
  };
}
