import { createRoot, type Root } from "react-dom/client";
import { requestChannelLiveStatus, warmChannelAnalytics } from "@/shared/analyticsClient";
import { InlineWidget } from "./InlineWidget";
import "./content.css";

const ROOT_ID = "bottracker-inline-root";
const EXCLUDED_PATHS = new Set([
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

type MountPoint = {
  parent: Element;
  after: Element | null;
  layout: "meta-tray" | "default";
};

let rootNode: HTMLDivElement | null = null;
let root: Root | null = null;
let lastSignature = "";
let warmScanInFlight = false;
let pageObserver: MutationObserver | null = null;
let renderIntervalId: number | null = null;
let warmScanIntervalId: number | null = null;
let routeSyncIntervalId: number | null = null;
let observersActive = false;
let liveStatusCheckInFlight = false;
let lastLiveStatusChannel = "";
let lastLiveStatusAt = 0;
let lastKnownStreamLive = false;

const VIEWER_COUNT_SELECTORS = [
  "[data-a-target='animated-channel-viewers-count']",
  "[data-a-target='channel-viewers-count']",
];
const VIEWER_COUNT_ROOT_SELECTORS = [
  ".ffz--meta-tray",
  "#live-channel-stream-information",
  ".channel-info-content",
];

function detectChannelName(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const candidate = parts[0]?.toLowerCase() || "";
  if (!candidate || EXCLUDED_PATHS.has(candidate)) {
    return null;
  }
  return candidate;
}

function readChannelGame(): string {
  const selectors = [
    "a[data-a-target='stream-game-link']",
    "a[href*='/directory/category/']",
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) {
      return text;
    }
  }

  return "Live channel";
}

function findViewerCountElement(): Element | null {
  for (const rootSelector of VIEWER_COUNT_ROOT_SELECTORS) {
    const root = document.querySelector(rootSelector);
    if (!root) {
      continue;
    }

    for (const selector of VIEWER_COUNT_SELECTORS) {
      const element = root.querySelector(selector);
      if (element) {
        return element;
      }
    }
  }

  let singleCandidate: Element | null = null;
  for (const selector of VIEWER_COUNT_SELECTORS) {
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length === 1) {
      singleCandidate = elements[0];
      continue;
    }

    if (elements.length > 1) {
      return null;
    }
  }

  return singleCandidate;
}

function findMountPoint(): MountPoint | null {
  const metaTray = document.querySelector(".ffz--meta-tray");
  if (metaTray) {
    const uptimeStat = metaTray.querySelector("[data-key='uptime']");
    const playerStats = metaTray.querySelector("[data-key='player-stats']");
    if (uptimeStat) {
      return { parent: metaTray, after: uptimeStat, layout: "meta-tray" };
    }

    if (playerStats?.parentElement === metaTray) {
      return { parent: metaTray, after: playerStats.previousElementSibling, layout: "meta-tray" };
    }

    return { parent: metaTray, after: metaTray.lastElementChild, layout: "meta-tray" };
  }

  const channelInfo = document.querySelector(".channel-info-content");
  const streamInfo = channelInfo?.querySelector("#live-channel-stream-information");
  if (channelInfo && streamInfo) {
    return { parent: channelInfo, after: streamInfo, layout: "default" };
  }

  const viewerCountElement = findViewerCountElement();
  const viewerStat = viewerCountElement?.parentElement;
  if (viewerStat?.parentElement) {
    const metadataRow = viewerStat.parentElement;
    const uptimeElement = Array.from(metadataRow.querySelectorAll("span, p")).find((element) =>
      /^\d{1,2}:\d{2}:\d{2}$/.test((element.textContent || "").trim()),
    );

    if (uptimeElement?.parentElement === metadataRow) {
      return { parent: metadataRow, after: uptimeElement, layout: "default" };
    }

    return { parent: metadataRow, after: viewerStat, layout: "default" };
  }

  if (channelInfo) {
    return { parent: channelInfo, after: null, layout: "default" };
  }

  const streamTitle = document.querySelector("[data-a-target='stream-title']");
  if (streamTitle?.parentElement) {
    return { parent: streamTitle.parentElement, after: streamTitle, layout: "default" };
  }

  return null;
}

function parseViewerCount(text: string | null | undefined, requireViewerLabel = true): string {
  if (!text) {
    return "";
  }

  const pattern = requireViewerLabel
    ? /([\d,.]+(?:\s*[kKmM])?)\s*(?:viewer|viewers)\b/i
    : /([\d,.]+(?:\s*[kKmM])?)/i;
  const match = text.match(pattern);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}

function readViewerCount(): string {
  const parsedDirect = parseViewerCount(findViewerCountElement()?.textContent, false);
  if (parsedDirect) {
    return parsedDirect;
  }

  const roots = [document.querySelector("#live-channel-stream-information"), document.querySelector(".channel-info-content")];
  for (const rootElement of roots) {
    const parsed = parseViewerCount(rootElement?.textContent);
    if (parsed) {
      return parsed;
    }
  }

  return "LIVE";
}

function ensureRoot(mountPoint: MountPoint): void {
  if (!rootNode) {
    rootNode = document.createElement("div");
    rootNode.id = ROOT_ID;
  }

  rootNode.classList.toggle("bt-inline-root--meta-tray", mountPoint.layout === "meta-tray");
  rootNode.style.order = mountPoint.layout === "meta-tray" ? "2" : "";

  const shouldMove =
    !rootNode.isConnected ||
    rootNode.parentElement !== mountPoint.parent ||
    (mountPoint.after ? rootNode.previousElementSibling !== mountPoint.after : rootNode.parentElement?.lastElementChild !== rootNode);

  if (shouldMove) {
    if (mountPoint.after?.nextSibling) {
      mountPoint.parent.insertBefore(rootNode, mountPoint.after.nextSibling);
    } else {
      mountPoint.parent.appendChild(rootNode);
    }
  }

  if (!root) {
    root = createRoot(rootNode);
  }
}

function clearWidget() {
  root?.render(null);
  rootNode?.remove();
  lastSignature = "";
}

function isFullscreenActive(): boolean {
  return document.fullscreenElement !== null;
}

function renderWidget() {
  if (isFullscreenActive()) {
    clearWidget();
    return;
  }

  const channelName = detectChannelName();
  if (!channelName) {
    clearWidget();
    return;
  }

  const mountPoint = findMountPoint();
  if (!mountPoint) {
    return;
  }

  ensureRoot(mountPoint);
  const viewerCount = readViewerCount();
  const channelGame = readChannelGame();
  const signature = `${channelName}|${channelGame}|${viewerCount}|${window.location.pathname}`;
  if (signature === lastSignature) {
    return;
  }

  lastSignature = signature;
  root?.render(
    <InlineWidget
      channelName={channelName}
      channelGame={channelGame}
      viewerCount={viewerCount}
    />,
  );
}

function stopEligiblePageWork() {
  pageObserver?.disconnect();
  pageObserver = null;

  if (renderIntervalId !== null) {
    window.clearInterval(renderIntervalId);
    renderIntervalId = null;
  }

  if (warmScanIntervalId !== null) {
    window.clearInterval(warmScanIntervalId);
    warmScanIntervalId = null;
  }

  clearWidget();
  observersActive = false;
}

function startEligiblePageWork() {
  if (observersActive) {
    renderWidget();
    return;
  }

  observersActive = true;
  renderWidget();
  warmActiveStreamScan();

  pageObserver = new MutationObserver(() => {
    renderWidget();
  });

  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  renderIntervalId = window.setInterval(() => {
    renderWidget();
  }, 1000);

  warmScanIntervalId = window.setInterval(() => {
    warmActiveStreamScan();
  }, 5000);
}

async function syncEligiblePageWork() {
  if (isFullscreenActive()) {
    stopEligiblePageWork();
    return;
  }

  const channelName = detectChannelName();
  if (!channelName) {
    stopEligiblePageWork();
    lastLiveStatusChannel = "";
    lastLiveStatusAt = 0;
    lastKnownStreamLive = false;
    return;
  }

  const now = Date.now();
  const shouldRefreshStatus = channelName !== lastLiveStatusChannel || now - lastLiveStatusAt >= 5000;

  if (!shouldRefreshStatus) {
    if (lastKnownStreamLive) {
      if (!observersActive) {
        startEligiblePageWork();
      }
    } else {
      stopEligiblePageWork();
    }
    return;
  }

  if (liveStatusCheckInFlight) {
    return;
  }

  liveStatusCheckInFlight = true;
  try {
    const liveStatus = await requestChannelLiveStatus(channelName);
    lastLiveStatusChannel = channelName;
    lastLiveStatusAt = Date.now();
    lastKnownStreamLive = liveStatus.streamLive;

    if (liveStatus.streamLive) {
      startEligiblePageWork();
      return;
    }

    stopEligiblePageWork();
  } catch {
    // Keep the current page state if the lightweight live check fails.
  } finally {
    liveStatusCheckInFlight = false;
  }
}

async function warmActiveStreamScan(): Promise<void> {
  const channelName = detectChannelName();
  if (!channelName || warmScanInFlight) {
    return;
  }

  warmScanInFlight = true;
  try {
    await warmChannelAnalytics({
      channelName,
      channelGame: readChannelGame(),
      viewerCount: readViewerCount(),
    });
  } catch {
    // Keep the UI running even if a background refresh fails.
  } finally {
    warmScanInFlight = false;
  }
}

function start() {
  syncEligiblePageWork().catch(() => undefined);

  document.addEventListener("fullscreenchange", () => {
    syncEligiblePageWork().catch(() => undefined);
  });

  if (routeSyncIntervalId === null) {
    routeSyncIntervalId = window.setInterval(() => {
      syncEligiblePageWork().catch(() => undefined);
    }, 1000);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
