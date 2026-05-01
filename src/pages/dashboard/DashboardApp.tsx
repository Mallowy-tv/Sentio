import { useEffect, useMemo, useState } from "react";
import { ScannerDashboard } from "@/components/ScannerDashboard";
import type { Channel, ChannelSnapshot } from "@/shared/analytics";
import { clearChannelAnalyticsSession, requestChannelAnalytics } from "@/shared/analyticsClient";
import { DASHBOARD_STORAGE_KEY, EXPERIMENTAL_SETTINGS_STORAGE_KEY, type DashboardContext, type ExperimentalSettings } from "@/shared/extension";

type DashboardState = {
  channelName: string;
  viewerCount: string;
  channelGame: string;
  experimentalEnabled: boolean;
};

async function loadDashboardState(): Promise<DashboardState> {
  const params = new URLSearchParams(window.location.search);
  let channelName = params.get("channel") || "";
  let viewerCount = params.get("viewers") || "";
  const stored = await chrome.storage.local.get([DASHBOARD_STORAGE_KEY, EXPERIMENTAL_SETTINGS_STORAGE_KEY]);
  const context = stored[DASHBOARD_STORAGE_KEY] as DashboardContext | undefined;
  const experimental = stored[EXPERIMENTAL_SETTINGS_STORAGE_KEY] as ExperimentalSettings | undefined;

  channelName ||= context?.channelName || "";
  viewerCount ||= context?.viewerCount || "";

  return {
    channelName,
    viewerCount,
    channelGame: context?.channelGame || "Live channel",
    experimentalEnabled: experimental?.enhancedDetectionSignals === true,
  };
}

export function DashboardApp() {
  const [context, setContext] = useState<DashboardState>({ channelName: "", viewerCount: "", channelGame: "Live channel", experimentalEnabled: false });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null);
  const [clearChannelPending, setClearChannelPending] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

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
  }, [context.channelGame, context.channelName, context.experimentalEnabled, context.viewerCount, refreshTick]);

  const availableChannels = useMemo(
    () => (channels.length ? channels : snapshot ? [snapshot.channel] : []),
    [channels, snapshot],
  );

  return (
    <ScannerDashboard
      initialChannelName={context.channelName}
      channels={availableChannels}
      analytics={snapshot}
      experimentalEnabled={context.experimentalEnabled}
      clearChannelPending={clearChannelPending}
      onExperimentalChange={(enabled) => {
        setContext((current) => ({ ...current, experimentalEnabled: enabled }));
        void chrome.storage.local.set({
          [EXPERIMENTAL_SETTINGS_STORAGE_KEY]: {
            enhancedDetectionSignals: enabled,
          } satisfies ExperimentalSettings,
        });
      }}
      onChannelChange={(channel) =>
        setContext((current) => ({
          ...current,
          channelName: channel.name,
          channelGame: channel.game,
          viewerCount: "",
        }))
      }
      onClearChannelSession={async (channel) => {
        if (!channel.name) {
          return;
        }

        setClearChannelPending(true);
        try {
          await clearChannelAnalyticsSession(channel.name);
          setSnapshot((current) => (current?.channel.name === channel.name ? null : current));
          setRefreshTick((current) => current + 1);
        } finally {
          setClearChannelPending(false);
        }
      }}
    />
  );
}
