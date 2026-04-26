import type { Channel, ChannelSnapshot } from "./analytics";
import type { DashboardContext } from "./extension";

type AnalyticsResponse = {
  success: boolean;
  snapshot?: ChannelSnapshot | null;
  recentChannels?: Channel[];
  error?: string;
};

export async function requestChannelAnalytics(context: DashboardContext): Promise<{ snapshot: ChannelSnapshot | null; recentChannels: Channel[] }> {
  const response = (await chrome.runtime.sendMessage({
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
  await chrome.runtime.sendMessage({
    type: "GET_CHANNEL_ANALYTICS",
    payload: context,
  });
}
