# Sentio

> A Twitch viewer scanner that helps you spot unusual audience patterns in a simple, visual way.

Sentio is a browser extension for people who want a clearer view of what is happening in a Twitch chat and audience. It adds a viewer count under the video, gives you a quick popup, and opens a full dashboard with labels, charts, and account signals that can help you investigate unusual activity.

> [!WARNING]
> Sentio estimates suspicious activity from Twitch community-tab sampling and account-enrichment signals. It is helpful for investigation, not proof.
>
> This tool is directional. Refresh issues, signed-out viewers, Twitch sampling limits, and missing profile data can all affect the result.

## ✨ What Sentio does

- 👀 Shows a Sentio viewer counter under a live Twitch stream
- 💬 Opens a quick popup when you click the counter
- 📊 Opens a full dashboard when you press **Dashboard**
- 🧭 Helps you spot unusual audience patterns over time
- 🏷️ Highlights signals like **New account**, **Day cluster**, **No bio**, and **Short watch**
- 📈 Shows live charts to make spikes and trends easier to notice

## 🚀 How to install

Sentio is currently installed as an unpacked browser extension.

> [!TIP]
> If someone gave you a ready-to-use Sentio folder, use that.
>
> If someone gave you the full project, choose the `BotTracker\dist` folder when loading the extension.

### Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select your Sentio folder.
5. Sentio should now appear in your extensions list.

### Edge

1. Open Edge and go to `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select your Sentio folder.
5. Sentio should now appear in your extensions list.

## 🧩 How to use Sentio

1. Open a live Twitch channel page.
2. Look under the video for the Sentio viewer counter.
3. Click the counter to open the popup.
4. Press **Dashboard** to open the full Sentio dashboard.
5. Use the search box and filters to review sampled viewers.
6. Click the **?** help button in the dashboard if you want a built-in explanation of the numbers and labels.

> [!NOTE]
> Sentio only works on real Twitch channel pages. If you are on a non-channel page, the extension button will be disabled and grayed out.

## 🔎 Understanding the numbers

| Number | What it means |
| --- | --- |
| **Live viewers** | Twitch's current public viewer count for the stream |
| **Authenticated** | The signed-in community-tab count Twitch exposes |
| **Sampled** | The running set of accounts Sentio has seen during repeated community-tab samples |
| **Safe / Watch / Suspicious** | Groups based on Sentio's scoring signals |

> [!IMPORTANT]
> These numbers can look very different from each other.
>
> For example, **Sampled** can be much higher than **Live viewers** because Sentio keeps a running session set of accounts seen across repeated samples, not just the people visible right now.

## ❓ FAQ

### Does Sentio prove that someone is botting?

No. Sentio helps you investigate patterns. It does not give final proof.

### Why are Sentio's numbers different from Twitch's live viewer count?

Because they are not measuring the exact same thing. Live viewers come from Twitch's stream count, while sampled totals come from repeated community-tab sampling over time.

### Why can sampled, safe, or suspicious be higher than live viewers?

Because Sentio keeps a running session-wide sample of unique accounts it has seen. That total can grow as more samples are collected.

### What do the labels mean?

| Label | Meaning |
| --- | --- |
| **New account** | The account appears recently created |
| **Day cluster** | Many sampled accounts share the same creation day |
| **No bio** | The profile has no description |
| **Short watch** | The account has only been seen briefly so far |
| **Watching** | The account has been seen across multiple later samples |

These labels are signals, not verdicts.

### Why is the extension icon gray sometimes?

Sentio only works on real Twitch channel pages. When you are not on a Twitch channel, the extension is disabled and grayed out.

### Does Sentio work on every Twitch page?

No. It is meant for live channel pages. It does not activate on general Twitch pages like search, settings, directory pages, or other non-channel pages.

### Do I need to understand technical details to use it?

No. You can use the viewer counter, popup, dashboard, filters, and FAQ without any coding knowledge.

## 🟣 In simple terms

Sentio is best used as a **signal tool**. It helps you notice patterns that may deserve a closer look. It should not be treated as a final answer on its own.
