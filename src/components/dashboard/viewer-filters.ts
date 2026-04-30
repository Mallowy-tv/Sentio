import { TAG_LABELS, scoreBand, type ScoreTag, type Viewer } from "@/shared/analytics";

export type Filter = "all" | "suspicious" | "watch" | "safe";
export type ScoreBandFilter = Exclude<Filter, "all">;
export type PresenceFilter = "all" | "present" | "not_present";
export type ProfileFilter = "all" | "blank" | "has_bio" | "bio_unknown";
export type AvatarFilter = "all" | "default" | "custom" | "missing";
export type AgeFilter = "all" | "lt30" | "lt90" | "gte90" | "unknown";
export type WatchFilter = "all" | "lt5" | "gte5" | "gte30";
export type SameDayFilter = "all" | "gte5" | "gte10";
export type TagMode = "any" | "all";

export type ViewerFilters = {
  bands: ScoreBandFilter[];
  presence: PresenceFilter;
  profile: ProfileFilter;
  avatar: AvatarFilter;
  age: AgeFilter;
  watch: WatchFilter;
  sameDay: SameDayFilter;
  tagMode: TagMode;
  selectedTags: ScoreTag[];
  scoreMin: string;
  scoreMax: string;
};

export const BAND_COPY: Record<Filter, string> = {
  all: "All",
  suspicious: "High signal",
  watch: "Needs review",
  safe: "Low signal",
};

export const SCORE_BAND_OPTIONS: ScoreBandFilter[] = ["suspicious", "watch", "safe"];
export const TAG_FILTER_OPTIONS: ScoreTag[] = [
  "new_account",
  "clustered_creation",
  "same_day_cluster",
  "repeated_bio",
  "no_description",
  "default_avatar",
  "missing_created_at",
  "short_watch",
];

export const DEFAULT_VIEWER_FILTERS: ViewerFilters = {
  bands: [...SCORE_BAND_OPTIONS],
  presence: "all",
  profile: "all",
  avatar: "all",
  age: "all",
  watch: "all",
  sameDay: "all",
  tagMode: "any",
  selectedTags: [],
  scoreMin: "",
  scoreMax: "",
};

export function getViewerAgeDays(viewer: Viewer): number | null {
  if (!viewer.createdAt) {
    return null;
  }

  const createdAt = new Date(viewer.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));
}

export function hasViewerBio(description: string | null): boolean {
  return typeof description === "string" && description.trim().length > 0;
}

export function matchesViewerFilters(viewer: Viewer, filters: ViewerFilters): boolean {
  const band = scoreBand(viewer.score) as ScoreBandFilter;
  if (!filters.bands.includes(band)) {
    return false;
  }

  if (filters.presence === "present" && !viewer.present) {
    return false;
  }
  if (filters.presence === "not_present" && viewer.present) {
    return false;
  }

  const hasBio = viewer.userInfoStatus === "resolved" && hasViewerBio(viewer.description);
  const hasBlankBio = viewer.userInfoStatus === "resolved" && !hasViewerBio(viewer.description);
  const bioUnknown = viewer.userInfoStatus !== "resolved";
  if (filters.profile === "has_bio" && !hasBio) {
    return false;
  }
  if (filters.profile === "blank" && !hasBlankBio) {
    return false;
  }
  if (filters.profile === "bio_unknown" && !bioUnknown) {
    return false;
  }

  const hasDefaultAvatar = viewer.tags.includes("default_avatar");
  const hasAvatar = Boolean(viewer.profileImageURL);
  if (filters.avatar === "default" && !hasDefaultAvatar) {
    return false;
  }
  if (filters.avatar === "custom" && (!hasAvatar || hasDefaultAvatar)) {
    return false;
  }
  if (filters.avatar === "missing" && hasAvatar) {
    return false;
  }

  const ageDays = getViewerAgeDays(viewer);
  if (filters.age === "lt30" && !(ageDays !== null && ageDays < 30)) {
    return false;
  }
  if (filters.age === "lt90" && !(ageDays !== null && ageDays < 90)) {
    return false;
  }
  if (filters.age === "gte90" && !(ageDays !== null && ageDays >= 90)) {
    return false;
  }
  if (filters.age === "unknown" && ageDays !== null) {
    return false;
  }

  if (filters.watch === "lt5" && viewer.watchTimeMinutes >= 5) {
    return false;
  }
  if (filters.watch === "gte5" && viewer.watchTimeMinutes < 5) {
    return false;
  }
  if (filters.watch === "gte30" && viewer.watchTimeMinutes < 30) {
    return false;
  }

  if (filters.sameDay === "gte5" && viewer.accountsOnSameDay < 5) {
    return false;
  }
  if (filters.sameDay === "gte10" && viewer.accountsOnSameDay < 10) {
    return false;
  }

  const minScore = filters.scoreMin.trim() ? Number(filters.scoreMin) : null;
  const maxScore = filters.scoreMax.trim() ? Number(filters.scoreMax) : null;
  if (minScore !== null && Number.isFinite(minScore) && viewer.score < minScore) {
    return false;
  }
  if (maxScore !== null && Number.isFinite(maxScore) && viewer.score > maxScore) {
    return false;
  }

  if (filters.selectedTags.length) {
    const matchesTagSelection =
      filters.tagMode === "all"
        ? filters.selectedTags.every((tag) => viewer.tags.includes(tag))
        : filters.selectedTags.some((tag) => viewer.tags.includes(tag));

    if (!matchesTagSelection) {
      return false;
    }
  }

  return true;
}

export function countActiveViewerFilters(filters: ViewerFilters): number {
  let count = 0;
  if (filters.bands.length !== DEFAULT_VIEWER_FILTERS.bands.length) count += 1;
  if (filters.presence !== DEFAULT_VIEWER_FILTERS.presence) count += 1;
  if (filters.profile !== DEFAULT_VIEWER_FILTERS.profile) count += 1;
  if (filters.avatar !== DEFAULT_VIEWER_FILTERS.avatar) count += 1;
  if (filters.age !== DEFAULT_VIEWER_FILTERS.age) count += 1;
  if (filters.watch !== DEFAULT_VIEWER_FILTERS.watch) count += 1;
  if (filters.sameDay !== DEFAULT_VIEWER_FILTERS.sameDay) count += 1;
  if (filters.selectedTags.length) count += 1;
  if (filters.scoreMin.trim()) count += 1;
  if (filters.scoreMax.trim()) count += 1;
  return count;
}

export function buildActiveFilterLabels(viewerFilters: ViewerFilters): string[] {
  const labels: string[] = [];
  if (viewerFilters.bands.length !== SCORE_BAND_OPTIONS.length) {
    labels.push(viewerFilters.bands.map((band) => BAND_COPY[band]).join(" + "));
  }
  if (viewerFilters.presence === "present") labels.push("Seen now");
  if (viewerFilters.presence === "not_present") labels.push("Sampled earlier");
  if (viewerFilters.profile === "blank") labels.push("No bio");
  if (viewerFilters.profile === "has_bio") labels.push("Has bio");
  if (viewerFilters.profile === "bio_unknown") labels.push("Bio unknown");
  if (viewerFilters.avatar === "default") labels.push("Default avatar");
  if (viewerFilters.avatar === "custom") labels.push("Custom avatar");
  if (viewerFilters.avatar === "missing") labels.push("No avatar");
  if (viewerFilters.age === "lt30") labels.push("Age <30d");
  if (viewerFilters.age === "lt90") labels.push("Age <90d");
  if (viewerFilters.age === "gte90") labels.push("Age 90d+");
  if (viewerFilters.age === "unknown") labels.push("Age unknown");
  if (viewerFilters.watch === "lt5") labels.push("Watch <5m");
  if (viewerFilters.watch === "gte5") labels.push("Watch 5m+");
  if (viewerFilters.watch === "gte30") labels.push("Watch 30m+");
  if (viewerFilters.sameDay === "gte5") labels.push("Day cluster 5+");
  if (viewerFilters.sameDay === "gte10") labels.push("Day cluster 10+");
  if (viewerFilters.selectedTags.length) {
    labels.push(
      `${viewerFilters.tagMode === "all" ? "All" : "Any"} tags: ${viewerFilters.selectedTags
        .map((tag) => TAG_LABELS[tag].label)
        .join(", ")}`,
    );
  }
  if (viewerFilters.scoreMin.trim()) labels.push(`Score >= ${viewerFilters.scoreMin.trim()}`);
  if (viewerFilters.scoreMax.trim()) labels.push(`Score <= ${viewerFilters.scoreMax.trim()}`);
  return labels;
}
