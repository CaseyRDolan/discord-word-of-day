import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "rss-parser";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultWordsFile = path.join(scriptDir, "words.json");
const defaultStateFile = path.join(scriptDir, ".last-posted.json");
const defaultMerriamWebsterFeedUrl = "https://www.merriam-webster.com/wotd/feed/rss2";

loadEnvFile(path.join(scriptDir, ".env"));

const args = parseArgs(process.argv.slice(2));
const dryRun = args.has("dry-run") || isTruthy(process.env.DRY_RUN);
const force = args.has("force");
const timeZone = process.env.WOTD_TIMEZONE || "America/New_York";
const wordsFile = process.env.WOTD_WORDS_FILE
  ? path.resolve(process.env.WOTD_WORDS_FILE)
  : defaultWordsFile;
const stateFile = process.env.WOTD_STATE_FILE
  ? path.resolve(process.env.WOTD_STATE_FILE)
  : defaultStateFile;
const source = process.env.WOTD_SOURCE || "merriam-webster";
const merriamWebsterFeedUrl =
  process.env.WOTD_MERRIAM_WEBSTER_FEED_URL || defaultMerriamWebsterFeedUrl;
const introText =
  process.env.WOTD_INTRO_TEXT || "Wordussies, today's word has dropped.";

const requestedDateKey = getDateKey({
  override: args.get("date") || process.env.WOTD_DATE,
  timeZone,
});
const word = await getWordOfDay({
  source,
  wordsFile,
  dateKey: requestedDateKey,
  timeZone,
  merriamWebsterFeedUrl,
  strictDate: Boolean(args.get("date") || process.env.WOTD_DATE),
});
const dateKey = word.date || requestedDateKey;

if (!dryRun && !force && alreadyPosted(stateFile, dateKey)) {
  console.log(`Already posted for ${dateKey}. Use --force to post again.`);
  process.exit(0);
}

const payload = buildDiscordPayload(word, dateKey);

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!webhookUrl) {
  throw new Error(
    "Missing DISCORD_WEBHOOK_URL. Copy .env.example to .env and paste your Discord webhook URL.",
  );
}

await postToDiscord(webhookUrl, payload);
writeState(stateFile, {
  date: dateKey,
  word: word.word,
  source: word.source,
  url: word.link,
  postedAt: new Date().toISOString(),
});

console.log(`Posted "${word.word}" for ${dateKey}.`);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const envText = fs.readFileSync(filePath, "utf8");
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsAt = line.indexOf("=");
    if (equalsAt === -1) continue;

    const key = line.slice(0, equalsAt).trim();
    let value = line.slice(equalsAt + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(rawArgs) {
  const parsed = new Map();

  for (const rawArg of rawArgs) {
    if (!rawArg.startsWith("--")) continue;

    const arg = rawArg.slice(2);
    const equalsAt = arg.indexOf("=");
    if (equalsAt === -1) {
      parsed.set(arg, true);
      continue;
    }

    parsed.set(arg.slice(0, equalsAt), arg.slice(equalsAt + 1));
  }

  return parsed;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function getDateKey({ override, timeZone }) {
  if (override) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(override)) {
      throw new Error("WOTD_DATE and --date must use YYYY-MM-DD.");
    }
    return override;
  }

  return formatDateKey(new Date(), timeZone);
}

function formatDateKey(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function getWordOfDay({
  source,
  wordsFile,
  dateKey,
  timeZone,
  merriamWebsterFeedUrl,
  strictDate,
}) {
  if (source === "local") {
    return getLocalWord(wordsFile, dateKey);
  }

  if (source !== "merriam-webster") {
    throw new Error("WOTD_SOURCE must be merriam-webster or local.");
  }

  try {
    return await fetchMerriamWebsterWord({
      feedUrl: merriamWebsterFeedUrl,
      dateKey,
      timeZone,
      strictDate,
    });
  } catch (error) {
    if (process.env.WOTD_ALLOW_LOCAL_FALLBACK === "0") {
      throw error;
    }

    console.warn(
      `Could not fetch Merriam-Webster Word of the Day: ${error.message}. Using local fallback.`,
    );
    return getLocalWord(wordsFile, dateKey, "Local fallback");
  }
}

function getLocalWord(wordsFile, dateKey, source = "Local") {
  const words = loadWords(wordsFile);
  return {
    ...pickWord(words, dateKey),
    date: dateKey,
    source,
  };
}

async function fetchMerriamWebsterWord({ feedUrl, dateKey, timeZone, strictDate }) {
  const parser = new Parser({
    customFields: {
      item: [
        ["merriam:shortdef", "shortdef"],
        ["itunes:summary", "itunesSummary"],
      ],
    },
  });

  const feed = await parser.parseURL(feedUrl);
  if (!feed.items?.length) {
    throw new Error("Merriam-Webster RSS feed did not include any items.");
  }

  const matchingItem = feed.items.find((item) => {
    if (!item.pubDate) return false;
    return formatDateKey(new Date(item.pubDate), timeZone) === dateKey;
  });

  if (strictDate && !matchingItem) {
    throw new Error(`Merriam-Webster RSS feed did not include ${dateKey}.`);
  }

  const item = matchingItem || feed.items[0];
  const meta = parseMerriamWebsterSummary(
    item.itunesSummary || item.contentSnippet || item.content || "",
  );
  const itemDateKey = item.pubDate
    ? formatDateKey(new Date(item.pubDate), timeZone)
    : dateKey;
  const word = cleanText(item.title || meta.word);
  const definition = cleanText(item.shortdef || meta.definition);

  if (!word || !definition) {
    throw new Error("Merriam-Webster RSS item was missing a word or definition.");
  }

  return {
    word,
    pronunciation: meta.pronunciation,
    partOfSpeech: meta.partOfSpeech,
    definition,
    example: meta.example,
    didYouKnow: meta.didYouKnow,
    link: item.link,
    audioUrl: item.enclosure?.url,
    date: itemDateKey,
    source: "Merriam-Webster",
  };
}

function parseMerriamWebsterSummary(summary) {
  const text = summary.replace(/\r/g, "").replace(/\u00a0/g, " ");
  const headerMatch = text.match(
    /Word of the Day for [A-Za-z]+ \d{1,2}, \d{4} is:\s*(.+?)\s+\\([^\\]+)\\\s+([^\n]+?)\s*\n/i,
  );
  const definitionText = headerMatch
    ? text.slice(headerMatch.index + headerMatch[0].length)
    : text;
  const didYouKnow = extractSection(text, /Did you know\?\s*/i);

  return {
    word: cleanText(headerMatch?.[1]),
    pronunciation: cleanText(headerMatch?.[2]),
    partOfSpeech: cleanText(headerMatch?.[3]),
    definition: cleanText(
      definitionText
        .split(/\n\s*\/\/|\n\s*\[See the entry|Examples:/i)[0]
        ?.trim(),
    ),
    example: cleanText(extractMerriamWebsterExamples(definitionText)),
    didYouKnow: cleanText(didYouKnow),
  };
}

function extractMerriamWebsterExamples(text) {
  const examples = [];
  const examplePattern =
    /(?:^|\n)\s*\/\/\s*([\s\S]*?)(?=\n\s*(?:\/\/|\[See the entry|Examples:|Did you know\?)|$)/gi;
  let match;

  while ((match = examplePattern.exec(text))) {
    const example = cleanText(match[1]);
    if (example) {
      examples.push(example);
    }
  }

  return examples.join("\n");
}

function extractSection(text, headingPattern) {
  const headingMatch = text.match(headingPattern);
  if (!headingMatch || headingMatch.index === undefined) return "";

  const section = text.slice(headingMatch.index + headingMatch[0].length);
  return section.split(/\n\s*(?:Examples:|Did you know\?)\s*/i)[0];
}

function cleanText(text) {
  if (!text) return "";

  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#149;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadWords(filePath) {
  const words = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!Array.isArray(words) || words.length === 0) {
    throw new Error(`${filePath} must contain at least one word.`);
  }

  for (const [index, entry] of words.entries()) {
    for (const requiredKey of ["word", "partOfSpeech", "definition", "example"]) {
      if (!entry[requiredKey]) {
        throw new Error(`words.json entry ${index + 1} is missing ${requiredKey}.`);
      }
    }
  }

  return words;
}

function pickWord(words, dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const dayNumber = Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(2026, 0, 1)) / 86_400_000,
  );
  const index = positiveModulo(dayNumber, words.length);
  return words[index];
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function alreadyPosted(filePath, dateKey) {
  if (!fs.existsSync(filePath)) return false;

  try {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return state.date === dateKey;
  } catch {
    return false;
  }
}

function buildDiscordPayload(word, dateKey) {
  const wordLink = normalizeDiscordUrl(word.link);
  const audioUrl = normalizeDiscordUrl(word.audioUrl);
  const fields = [];

  if (word.pronunciation) {
    fields.push({
      name: "Pronunciation",
      value: `\\${word.pronunciation}\\`,
      inline: true,
    });
  }

  if (word.partOfSpeech) {
    fields.push({
      name: "Part of speech",
      value: word.partOfSpeech,
      inline: true,
    });
  }

  if (word.example) {
    fields.push({
      name: "Example Sentence",
      value: truncate(word.example, 900),
      inline: false,
    });
  }

  if (word.didYouKnow) {
    fields.push({
      name: "Origin / Did You Know?",
      value: truncate(word.didYouKnow, 650),
      inline: false,
    });
  }

  if (audioUrl) {
    fields.push({
      name: "Audio",
      value: `[Listen to Merriam-Webster's short audio](${audioUrl})`,
      inline: false,
    });
  }

  if (word.synonyms?.length) {
    fields.push({
      name: "Similar words",
      value: word.synonyms.join(", "),
      inline: false,
    });
  }

  if (word.source === "Merriam-Webster") {
    fields.push({
      name: "Source",
      value: wordLink
        ? `[Merriam-Webster Word of the Day](${wordLink})`
        : "Merriam-Webster Word of the Day",
      inline: false,
    });
  }

  const payload = {
    username: process.env.WOTD_USERNAME || "Word of the Day",
    embeds: [
      {
        author:
          word.source === "Merriam-Webster"
            ? {
                name: "Merriam-Webster Word of the Day",
                url: "https://www.merriam-webster.com/word-of-the-day",
              }
            : undefined,
        title: word.word,
        url: wordLink || undefined,
        description: `**Definition**\n${truncate(word.definition, 900)}`,
        color: Number.parseInt(process.env.WOTD_EMBED_COLOR || "3BA55D", 16),
        fields,
        footer: {
          text: `${word.source || "Word of the Day"} - ${dateKey}`,
        },
      },
    ],
  };

  if (process.env.WOTD_AVATAR_URL) {
    payload.avatar_url = process.env.WOTD_AVATAR_URL;
  }

  const roleMention = getRoleMention();
  const intro = personalizeText(introText, word);
  payload.content = roleMention ? `${roleMention.content} ${intro}` : intro;

  if (roleMention) {
    payload.allowed_mentions = roleMention.allowedMentions;
  }

  return payload;
}

function getRoleMention() {
  const roleId = process.env.WOTD_ROLE_ID?.trim();
  if (roleId) {
    if (!/^\d{17,20}$/.test(roleId)) {
      throw new Error("WOTD_ROLE_ID must be the numeric Discord role ID.");
    }

    return {
      content: `<@&${roleId}>`,
      allowedMentions: {
        roles: [roleId],
      },
    };
  }

  const roleMention = process.env.WOTD_ROLE_MENTION?.trim();
  if (!roleMention) return null;

  return {
    content: roleMention,
    allowedMentions: {
      parse: ["roles"],
    },
  };
}

function personalizeText(template, word) {
  return template.replaceAll("{word}", word.word);
}

function normalizeDiscordUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

async function postToDiscord(webhookUrl, payload) {
  const response = await sendDiscordPayload(webhookUrl, payload);

  if (response.ok) {
    return;
  }

  const body = await response.text();
  if (response.status === 400 && payload.embeds?.length) {
    console.warn(
      `Discord rejected the full embed (${body}). Retrying with the essential word card.`,
    );

    const fallbackResponse = await sendDiscordPayload(
      webhookUrl,
      buildEssentialDiscordPayload(payload),
    );

    if (fallbackResponse.ok) {
      return;
    }

    const fallbackBody = await fallbackResponse.text();
    throw new Error(
      `Discord webhook failed: ${response.status} ${body}; essential retry failed: ${fallbackResponse.status} ${fallbackBody}`,
    );
  }

  throw new Error(`Discord webhook failed: ${response.status} ${body}`);
}

function sendDiscordPayload(webhookUrl, payload) {
  return fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function buildEssentialDiscordPayload(payload) {
  const embed = payload.embeds[0];
  return {
    username: payload.username,
    avatar_url: payload.avatar_url,
    content: payload.content,
    allowed_mentions: payload.allowed_mentions,
    embeds: [
      {
        title: embed.title,
        description: embed.description,
        color: embed.color,
        footer: embed.footer,
      },
    ],
  };
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}
