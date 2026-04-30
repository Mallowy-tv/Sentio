type GuideModalProps = {
  open: boolean;
  onClose: () => void;
};

export function GuideModal({ open, onClose }: GuideModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        className="sentio-scrollbar max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl sm:max-h-[calc(100vh-3rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">How Sentio works</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This view estimates suspicious activity from Twitch community-tab sampling and account-enrichment signals. It is helpful for investigation, not proof.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h3 className="text-sm font-semibold">Sampling</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              We repeatedly sample Twitch&apos;s community tab and keep a running session set of accounts we have seen. That means sampled totals can grow above the current authenticated count.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h3 className="text-sm font-semibold">Why the numbers can look far apart</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="text-foreground">Live viewers</span> is Twitch&apos;s current stream count. <span className="text-foreground">Authenticated</span> is the signed-in community-tab count Twitch exposes.{" "}
              <span className="text-foreground">Sampled</span>, <span className="text-foreground">Low signal</span>, <span className="text-foreground">Needs review</span>, and{" "}
              <span className="text-foreground">High signal</span> are based on the running sampled session set, so they can be much higher than live when many unique accounts have been seen across repeated samples.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h3 className="text-sm font-semibold">Scoring</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Scores are based on account age, creation-date clustering, same-day account density, repeated bios, missing bio, default avatar, short watch duration, and how those weak signals stack together. Higher scores mean
              more review signals, not certainty.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h3 className="text-sm font-semibold">Labels</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Labels summarize the strongest signals we currently have, such as <span className="text-foreground">New account</span>, <span className="text-foreground">Day cluster</span>,{" "}
              <span className="text-foreground">Repeated bio</span>, <span className="text-foreground">No bio</span>, <span className="text-foreground">Default avatar</span>, and{" "}
              <span className="text-foreground">Short watch</span>.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <h3 className="text-sm font-semibold">Watch-time and live data</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Watch-time only grows when we keep seeing an account in later samples. That means Sentio is usually rougher on the first sweep, then becomes more accurate after a few minutes as it circles back, confirms who is still
              watching, and lets the score bands stabilize. Live viewers come from Twitch&apos;s live count, while sampled risk totals come from the session-wide sampled set and may lag or overstate current presence.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning)]/10 p-4 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Important:</span> this tool is directional. Refresh issues, signed-out viewers, Twitch sampling limits, and missing profile data can all affect the result.
        </div>
      </div>
    </div>
  );
}
