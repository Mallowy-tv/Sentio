# Sentio

> A Twitch viewer scanner that helps you spot unusual audience patterns in a simple, visual way.

Sentio is a browser extension for people who want a clearer view of what is happening in a Twitch audience. It adds a viewer count under the stream, gives you a quick popup, and opens a full dashboard with charts, labels, filters, and account-level signals that can help you investigate unusual activity.

> [!WARNING]
> Sentio estimates suspicious activity from Twitch community-tab sampling and account-enrichment signals. It is helpful for investigation, not proof.
>
> This tool is directional. Refresh issues, signed-out viewers, Twitch sampling limits, and missing profile data can all affect the result.

## Quick start

### Install from the Chrome Web Store

Install Sentio here:

**https://chromewebstore.google.com/detail/sentio/fcljbfiejekfhbckfoamdanldhphmiii**

### Alternative install: unpacked extension

If you want to install Sentio manually, keep using the unpacked build.

> [!TIP]
> If someone gave you a ready-to-use Sentio folder, select that folder directly.
>
> If someone gave you the full project, select `BotTracker\dist`.

<details>
<summary><strong>Chrome</strong></summary>

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select your Sentio folder.
5. Sentio should now appear in your extensions list.

</details>

<details>
<summary><strong>Edge</strong></summary>

1. Open Edge and go to `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select your Sentio folder.
5. Sentio should now appear in your extensions list.

</details>

## What Sentio does

- Shows a Sentio viewer counter under a live Twitch stream
- Opens a quick popup when you click the counter
- Opens a full dashboard when you press **Dashboard**
- Helps you spot unusual audience patterns over time
- Highlights signals like **New account**, **Day cluster**, **No bio**, and **Short watch**
- Shows charts and viewer-level breakdowns to make patterns easier to review

## Usage

1. Open a live Twitch channel page.
2. Look under the video for the Sentio viewer counter.
3. Click the counter to open the popup.
4. Press **Dashboard** to open the full Sentio dashboard.
5. Use search, filters, and the viewer breakdown modal to inspect sampled accounts.
6. Click the **?** help button in the dashboard if you want a built-in explanation of the numbers and labels.

> [!NOTE]
> Sentio only works on real Twitch channel pages. If you are on a non-channel page, the extension button will be disabled and grayed out.

## Understanding the numbers

| Number | What it means |
| --- | --- |
| **Live viewers** | Twitch's current public viewer count for the stream |
| **Authenticated** | The signed-in community-tab count Twitch exposes |
| **Sampled** | The running set of accounts Sentio has seen during repeated community-tab samples |
| **Low signal / Needs review / High signal** | Viewer groups based on Sentio's scoring signals |

> [!IMPORTANT]
> These numbers can look very different from each other.
>
> For example, **Sampled** can be much higher than **Live viewers** because Sentio keeps a running session set of accounts seen across repeated samples, not just the people visible right now.

## Labels

| Label | Meaning |
| --- | --- |
| **New account** | The account appears recently created |
| **Day cluster** | Many sampled accounts share the same creation day |
| **Repeated bio** | Multiple sampled accounts share the exact same bio |
| **No bio** | The profile has no description |
| **Short watch** | The account has only been seen briefly so far |
| **Watching** | The account has been seen across multiple later samples |

These labels are signals, not verdicts.

## FAQ

<details>
<summary><strong>Does Sentio prove that someone is botting?</strong></summary>

No. Sentio helps you investigate patterns. It does not give final proof.

</details>

<details>
<summary><strong>Why are Sentio's numbers different from Twitch's live viewer count?</strong></summary>

They are not measuring the exact same thing. Live viewers come from Twitch's stream count, while sampled totals come from repeated community-tab sampling over time.

</details>

<details>
<summary><strong>Why can sampled, low signal, needs review, or high signal be higher than live viewers?</strong></summary>

Sentio keeps a running session-wide sample of unique accounts it has seen. That total can grow as more samples are collected.

</details>

<details>
<summary><strong>Why is the extension icon gray sometimes?</strong></summary>

Sentio only works on real Twitch channel pages. When you are not on a Twitch channel, the extension is disabled and grayed out.

</details>

<details>
<summary><strong>Does Sentio work on every Twitch page?</strong></summary>

No. It is meant for live channel pages. It does not activate on search, settings, directory pages, or other non-channel Twitch routes.

</details>

<details>
<summary><strong>Do I need to understand technical details to use it?</strong></summary>

No. You can use the viewer counter, popup, dashboard, filters, and built-in help without any coding knowledge.

</details>

## In simple terms

Sentio is best used as a **signal tool**. It helps you notice patterns that may deserve a closer look. It should not be treated as a final answer on its own.
