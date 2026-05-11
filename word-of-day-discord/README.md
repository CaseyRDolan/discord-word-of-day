# Discord Word of the Day

This posts Merriam-Webster's Word of the Day to a Discord channel using a webhook. It does not need a Discord bot token, hosting, or an always-on server.

## 1. Create the Discord webhook

In Discord, open the channel settings for the channel you want to post in.

1. Go to **Integrations**.
2. Open **Webhooks**.
3. Create a webhook.
4. Copy the webhook URL.

Keep the webhook URL private. Anyone with it can post to that channel.

## 2. Add your webhook URL

Open PowerShell in this folder:

```powershell
cd "C:\Users\kingl\OneDrive\Documents\New project 2\word-of-day-discord"
Copy-Item .env.example .env
notepad .env
```

Replace the example `DISCORD_WEBHOOK_URL` value with your real webhook URL.

## 3. Test without posting

```powershell
node .\post-word-of-day.mjs --dry-run
```

That prints the Discord message JSON so you can preview what would be posted. By default, it pulls from Merriam-Webster's public Word of the Day RSS feed.

## 4. Post a test message

```powershell
node .\post-word-of-day.mjs --force
```

The script remembers the date after a successful post and will skip duplicate posts on the same day. `--force` posts again anyway, which is useful for testing.

## 5. Schedule it daily on Windows

This creates a Windows scheduled task that runs every day at noon:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-daily-task.ps1 -At 12:00PM
```

To use another time:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-daily-task.ps1 -At 6:30PM
```

Your computer needs to be on or asleep in a way Windows can wake from. The task is allowed to wake the computer and is configured to run when available if it misses the exact time.

The scheduled task runs `run-word-of-day.ps1`, which writes logs to:

```text
C:\Users\kingl\OneDrive\Documents\New project 2\word-of-day-discord\logs
```

To test the scheduled-task path without posting:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-word-of-day.ps1 -DryRun
```

## 6. Hosted Schedule With GitHub Actions

The repo includes a GitHub Actions workflow at:

```text
.github/workflows/word-of-day.yml
```

That workflow runs in GitHub's cloud instead of on your computer. It checks twice per day in UTC so it can post at noon Eastern during both daylight saving time and standard time. Only the run that lands during the noon hour in `America/New_York` actually posts.

One-time setup:

1. Push this project to a GitHub repository.
2. In the GitHub repo, open **Settings**.
3. Go to **Secrets and variables** > **Actions**.
4. Create a repository secret named `DISCORD_WEBHOOK_URL`.
5. Paste your Discord webhook URL as the secret value.
6. Optional: create another repository secret named `GIPHY_API_KEY` to include the top GIF result for the daily word.
7. Open the **Actions** tab and enable workflows if GitHub asks.

You can test the hosted workflow manually from the **Actions** tab by choosing **Discord Word of the Day** and clicking **Run workflow**. Choose `dry_run=true` to preview without posting.

## Customizing

By default, the script uses Merriam-Webster:

```ini
WOTD_SOURCE=merriam-webster
WOTD_ALLOW_LOCAL_FALLBACK=1
```

`WOTD_ALLOW_LOCAL_FALLBACK=1` means the script will use `words.json` if Merriam-Webster cannot be reached. Set it to `0` if you want the task to fail instead.

You can also switch back to the built-in local word rotation:

```ini
WOTD_SOURCE=local
```

Edit `words.json` to add, remove, or change fallback/local words. Each entry needs:

```json
{
  "word": "luminous",
  "pronunciation": "LOO-muh-nus",
  "partOfSpeech": "adjective",
  "definition": "Giving off light, or clear and inspiring in a way that seems to glow.",
  "example": "Her explanation was so luminous that the whole problem finally made sense.",
  "synonyms": ["radiant", "bright", "lucid"]
}
```

Useful `.env` settings:

```ini
WOTD_TIMEZONE=America/New_York
WOTD_USERNAME=Word of the Day
WOTD_EMBED_COLOR=3BA55D
WOTD_SOURCE=merriam-webster
WOTD_INTRO_TEXT=Wordussies, today's word has dropped.
WOTD_CHALLENGE_TEXT=Use **{word}** in a sentence at some point today.
WOTD_GIF_ENABLED=1
WOTD_ROLE_ID=123456789012345678
```

The bot will replace `{word}` in the challenge text with the daily word.

To include a GIF, create a GIPHY API key from the GIPHY developer dashboard, then add it as:

```ini
GIPHY_API_KEY=your-giphy-api-key
```

When `WOTD_GIF_ENABLED=1` and `GIPHY_API_KEY` is configured, the bot searches GIPHY for the exact daily word, takes the first result, and displays it as the embed image.

If you add `WOTD_ROLE_ID`, use a Discord role ID, not the visible role name. In Discord, enable Developer Mode, right-click the `Wordussies` role, and choose **Copy Role ID**.
