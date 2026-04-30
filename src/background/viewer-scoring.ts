import { isDefaultProfileImageURL, scoreBand, type ChannelRemark, type ScoreContribution, type ScoreTag, type Viewer } from "../shared/analytics";
import { appendViewerEvent, describeViewerScoreBand, formatTagLabels, normalizeViewerDescription, normalizeViewerEvents, summarizeViewerDescription } from "./viewer-events";
import { type ChannelSession, type SessionViewer } from "./session-types";

const BOT_DATE_RANGE_START = "2020-01-01";
const LURKER_REMARK_MIN_TRACKING_MINUTES = 15;
const REPEATED_BIO_MIN_LENGTH = 16;
const REPEATED_BIO_MIN_COUNT = 3;
const REPEATED_BIO_MIN_RATIO = 0.02;

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

export function analyzeViewers(session: ChannelSession, streamLive = true, enhancedDetectionSignals = false) {
  const viewers = Array.from(session.viewers.values());
  const viewersWithDates = viewers.filter((viewer) => viewer.createdAt);
  const resolvedViewers = viewers.filter((viewer) => viewer.userInfoStatus === "resolved");
  const repeatedBioCounts = new Map<string, number>();
  resolvedViewers.forEach((viewer) => {
    const normalizedDescription = normalizeViewerDescription(viewer.description);
    if (!normalizedDescription || normalizedDescription.length < REPEATED_BIO_MIN_LENGTH) {
      return;
    }

    repeatedBioCounts.set(normalizedDescription, (repeatedBioCounts.get(normalizedDescription) ?? 0) + 1);
  });
  const blankProfileViewers = resolvedViewers.filter((viewer) => !normalizeViewerDescription(viewer.description) && isDefaultProfileImageURL(viewer.profileImageURL));
  const blankProfileShortWatchCount = blankProfileViewers.filter((viewer) => Math.max(0, Math.round((viewer.lastSeen - viewer.firstSeen) / 60000)) < 5).length;
  const blankProfileShortWatchRatio = resolvedViewers.length ? blankProfileShortWatchCount / resolvedViewers.length : 0;
  const { monthlyCounts, dayCounts } = buildAccountCreationCounts(viewers);
  const baselineStats = calculateBaselineStats(monthlyCounts, new Date(BOT_DATE_RANGE_START));
  const maxExpectedAccounts = calculateMaxExpectedAccounts(
    baselineStats.totalPostStartMonthsExcludingTopx,
    baselineStats.totalPostStartAccountsExcludingTopx,
  );
  const botCounts = calculateBotCounts(monthlyCounts, new Date(BOT_DATE_RANGE_START), maxExpectedAccounts);
  const botPercentage = viewersWithDates.length ? botCounts.totalBots / viewersWithDates.length : 0;
  const monthFlags = new Map((botPercentage >= 0.1 ? botCounts.monthData : []).filter((item) => item.bots > 0).map((item) => [item.month, item]));

  const analyzed = viewers.map((viewer) => {
    normalizeViewerEvents(viewer);
    const tags: ScoreTag[] = [];
    const scoreBreakdown: ScoreContribution[] = [];
    let score = 0;
    const normalizedDescription = normalizeViewerDescription(viewer.description);
    const previousScore = viewer.score;
    const previousTags = [...viewer.tags];
    const previousBand = describeViewerScoreBand(previousScore);
    const hadScoreEvent = viewer.events.some((event) => event.kind === "score");
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
        const dayClusterPoints = enhancedDetectionSignals ? Math.min(22, 10 + (viewer.accountsOnSameDay - 5) * 2) : Math.min(12, (viewer.accountsOnSameDay - 4) * 2);
        addScore(
          "same_day_cluster",
          "Same-day cluster",
          dayClusterPoints,
          `${viewer.accountsOnSameDay} sampled accounts share this exact account creation day.`,
        );
      }
    }

    const repeatedBioCount = normalizedDescription ? repeatedBioCounts.get(normalizedDescription) ?? 0 : 0;
    const repeatedBioRatio = resolvedViewers.length ? repeatedBioCount / resolvedViewers.length : 0;
    if (enhancedDetectionSignals && normalizedDescription && repeatedBioCount >= REPEATED_BIO_MIN_COUNT && repeatedBioRatio >= REPEATED_BIO_MIN_RATIO) {
      tags.push("repeated_bio");
      addScore(
        "repeated_bio",
        "Repeated bio",
        repeatedBioCount >= 5 ? 4 : 3,
        `${repeatedBioCount} sampled accounts share the exact same bio: "${summarizeViewerDescription(normalizedDescription)}".`,
      );
    }

    if (viewer.userInfoStatus === "resolved" && !normalizedDescription) {
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

    if (enhancedDetectionSignals && tags.includes("no_description") && tags.includes("default_avatar")) {
      addScore(
        "combo_blank_profile",
        "Blank profile shell",
        4,
        "An account with both no bio and Twitch's default avatar looks much less finished than a typical long-lived viewer profile.",
      );
    }

    if (enhancedDetectionSignals && tags.includes("no_description") && tags.includes("default_avatar") && tags.includes("short_watch")) {
      addScore(
        "combo_blank_profile_short_watch",
        "Blank profile + short watch",
        4,
        "A blank-profile account that only appears briefly is more suspicious than either pattern alone.",
      );
    }

    if (enhancedDetectionSignals && tags.includes("no_description") && tags.includes("default_avatar") && tags.includes("short_watch") && blankProfileShortWatchCount >= 10 && blankProfileShortWatchRatio >= 0.08) {
      const bulkShellPoints = blankProfileShortWatchRatio >= 0.2 ? 10 : blankProfileShortWatchRatio >= 0.12 ? 8 : 6;
      addScore(
        "combo_blank_profile_sample_pattern",
        "Repeated blank-profile pattern",
        bulkShellPoints,
        `${blankProfileShortWatchCount} sampled accounts (${(blankProfileShortWatchRatio * 100).toFixed(1)}% of resolved profiles) share the same blank-profile + short-watch pattern.`,
      );
    }

    if (enhancedDetectionSignals && tags.includes("same_day_cluster") && tags.includes("no_description") && tags.includes("default_avatar")) {
      addScore(
        "combo_day_cluster_blank_profile",
        "Day cluster + blank profile",
        6,
        "Multiple accounts sharing the exact creation day while still having default-profile signals is harder to dismiss as random noise.",
      );
    }

    if (tags.includes("clustered_creation") && tags.includes("same_day_cluster")) {
      addScore("combo_cluster_stack", "Creation cluster stack", 10, "Both the monthly creation bucket and the exact day cluster lean in the same direction.");
    }

    if (tags.includes("clustered_creation") && tags.includes("short_watch")) {
      addScore("combo_cluster_short_watch", "Cluster + short watch", 6, "A clustered account with very short watch-time stacks multiple weak signals.");
    }

    const nextScore = Math.max(0, Math.min(100, score));
    const nextBand = describeViewerScoreBand(nextScore);
    const addedTags = tags.filter((tag) => !previousTags.includes(tag));
    const removedTags = previousTags.filter((tag) => !tags.includes(tag));
    if (!hadScoreEvent || previousScore !== nextScore || previousBand !== nextBand || addedTags.length > 0 || removedTags.length > 0) {
      const detailParts: string[] = [`${previousBand} -> ${nextBand}`];
      if (addedTags.length > 0) {
        detailParts.push(`Added: ${formatTagLabels(addedTags)}`);
      }
      if (removedTags.length > 0) {
        detailParts.push(`Removed: ${formatTagLabels(removedTags)}`);
      }

      appendViewerEvent(session, viewer, {
        at: Date.now(),
        kind: "score",
        title: hadScoreEvent ? (previousBand !== nextBand ? "Score band changed" : "Score updated") : "Initial score calculated",
        detail: detailParts.join(" · "),
        scoreBefore: hadScoreEvent ? previousScore : undefined,
        scoreAfter: nextScore,
        addedTags,
        removedTags,
      });
    }

    viewer.score = nextScore;
    viewer.tags = tags;

    return {
      ...viewer,
      displayName: viewer.username,
      score: nextScore,
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

export function getTrackedHistoryMinutes(history: ChannelSession["history"]): number {
  if (history.length < 2) {
    return 0;
  }

  return Math.max(0, (history[history.length - 1].timestamp - history[0].timestamp) / 60000);
}

export function buildChannelRemarks(
  viewers: Viewer[],
  liveViewerCount: number,
  trackedMinutes: number,
  authenticatedCount: number,
  enhancedDetectionSignals = false,
): ChannelRemark[] {
  const remarks: ChannelRemark[] = [];
  const presentViewers = viewers.filter((viewer) => viewer.present);
  const shortWatchPresent = presentViewers.filter((viewer) => viewer.watchTimeMinutes < 5).length;
  const suspiciousPresent = presentViewers.filter((viewer) => scoreBand(viewer.score) === "suspicious").length;
  const authenticatedCoverage = authenticatedCount / Math.max(liveViewerCount, 1);
  const unseenLiveViewers = Math.max(0, liveViewerCount - authenticatedCount);

  if (enhancedDetectionSignals && liveViewerCount >= 1500 && authenticatedCount >= 50 && unseenLiveViewers >= 1000 && authenticatedCoverage <= 0.1) {
    remarks.push({
      id: "live-auth-gap",
      title: "Large live / authenticated gap",
      description:
        `${authenticatedCount.toLocaleString()} authenticated viewers are visible against ${liveViewerCount.toLocaleString()} live viewers (${(authenticatedCoverage * 100).toFixed(1)}% coverage). ` +
        "That kind of mismatch can happen when many viewers are signed out or not exposed in the community tab, but an extreme gap is also consistent with inflated live viewership.",
      tone: "warning",
    });
  }

  if (trackedMinutes < LURKER_REMARK_MIN_TRACKING_MINUTES || liveViewerCount < 75 || presentViewers.length < 40) {
    return remarks;
  }

  const shortWatchRatio = shortWatchPresent / Math.max(presentViewers.length, 1);
  const suspiciousRatio = suspiciousPresent / Math.max(presentViewers.length, 1);

  if (shortWatchRatio >= 0.65 && suspiciousRatio <= 0.3) {
    remarks.push({
      id: "lurker-heavy",
      title: "Lurker-heavy audience",
      description: "Many recently seen viewers still have short watch-time. On slower chats this can simply mean a quiet, lurker-heavy audience rather than a strong bot signal.",
      tone: "note",
    });
  }

  return remarks;
}
