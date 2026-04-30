export const DASHBOARD_STORAGE_KEY = "lastDashboardContext";
export const EXPERIMENTAL_SETTINGS_STORAGE_KEY = "experimentalSettings";
export const DASHBOARD_PAGE = "dashboard.html";

export type DashboardChannel = {
  name: string;
  displayName?: string;
  game?: string;
  avatarColor?: string;
  profileImageURL?: string | null;
};

export type DashboardContext = {
  channelName?: string;
  channelDisplayName?: string;
  channelGame?: string;
  channelAvatarColor?: string;
  channelProfileImageURL?: string | null;
  viewerCount?: string;
  recentChannels?: DashboardChannel[];
  updatedAt?: number;
};

export type ExperimentalSettings = {
  enhancedDetectionSignals?: boolean;
};
