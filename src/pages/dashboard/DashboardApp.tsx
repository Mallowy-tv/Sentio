import { useEffect, useMemo, useState } from "react";
import { ScannerDashboard } from "@/components/ScannerDashboard";
import type { Channel, ChannelSnapshot } from "@/shared/analytics";
import { requestChannelAnalytics } from "@/shared/analyticsClient";
import { DASHBOARD_STORAGE_KEY, type DashboardContext } from "@/shared/extension";

type DashboardState = {
  channelName: string;
  viewerCount: string;
  channelGame: string;
};

async function loadDashboardState(): Promise<DashboardState> {
  const params = new URLSearchParams(window.location.search);
  let channelName = params.get("channel") || "";
  let viewerCount = params.get("viewers") || "";
  const stored = await chrome.storage.local.get([DASHBOARD_STORAGE_KEY]);
  const context = stored[DASHBOARD_STORAGE_KEY] as DashboardContext | undefined;

  channelName ||= context?.channelName || "";
  viewerCount ||= context?.viewerCount || "";

  return {
    channelName,
    viewerCount,
    channelGame: context?.channelGame || "Live channel",
  };
}

export function DashboardApp() {
  const [context, setContext] = useState<DashboardState>({ channelName: "", viewerCount: "", channelGame: "Live channel" });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null);

  useEffect(() => {
    loadDashboardState().then(setContext);
  }, []);

  useEffect(() => {
    if (!context.channelName) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      const response = await requestChannelAnalytics({
        channelName: context.channelName,
        channelGame: context.channelGame,
        viewerCount: context.viewerCount,
      });

      if (cancelled) {
        return;
      }

      setChannels(response.recentChannels);
      setSnapshot(response.snapshot);
    };

    load().catch(() => undefined);
    const interval = window.setInterval(() => {
      load().catch(() => undefined);
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [context.channelGame, context.channelName, context.viewerCount]);

  const availableChannels = useMemo(
    () => (channels.length ? channels : snapshot ? [snapshot.channel] : []),
    [channels, snapshot],
  );

  return (
    <ScannerDashboard
      initialChannelName={context.channelName}
      channels={availableChannels}
      analytics={snapshot}
      onChannelChange={(channel) =>
        setContext((current) => ({
          ...current,
          channelName: channel.name,
          channelGame: channel.game,
        }))
      }
    />
  );
}
