import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

loadEnvFile(path.join(scriptDir, ".env"));

const args = parseArgs(process.argv.slice(2));
const dryRun = args.has("dry-run") || isTruthy(process.env.DRY_RUN);
const forceSend = args.has("force") || isTruthy(process.env.FORCE_SEND);
const timeZone = process.env.WAKE_UP_TIMEZONE || "America/New_York";
const userIds = parseUserIds(process.env.WAKE_UP_USER_IDS);
const message = process.env.WAKE_UP_MESSAGE || "WAKE UP";
const deleteAfterMs = parseNonNegativeInteger(
  process.env.WAKE_UP_DELETE_AFTER_MS ?? "0",
  "WAKE_UP_DELETE_AFTER_MS",
);
const chancePercent = parseChance(process.env.WAKE_UP_CHANCE_PERCENT ?? "4");
const allowedHours = parseAllowedHours(process.env.WAKE_UP_ALLOWED_HOURS);

if (userIds.length === 0) {
  throw new Error("WAKE_UP_USER_IDS must contain at least one numeric Discord user ID.");
}

const now = new Date();
const localHour = getLocalHour(now, timeZone);

if (!forceSend && allowedHours && !allowedHours.has(localHour)) {
  console.log(`Skipping because local hour ${localHour} is outside WAKE_UP_ALLOWED_HOURS.`);
  process.exit(0);
}

const roll = Math.random() * 100;
if (!forceSend && roll >= chancePercent) {
  console.log(
    `Skipping because random roll ${roll.toFixed(2)} was not below ${chancePercent}.`,
  );
  process.exit(0);
}

const targetUserId = choose(userIds);
const payload = {
  content: `<@${targetUserId}> ${message}`,
  allowed_mentions: {
    users: [targetUserId],
  },
};

if (dryRun) {
  console.log(JSON.stringify({ deleteAfterMs, payload }, null, 2));
  process.exit(0);
}

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!webhookUrl) {
  throw new Error("Missing DISCORD_WEBHOOK_URL.");
}

const sentMessage = await sendWebhookMessage(webhookUrl, payload);

if (deleteAfterMs > 0) {
  await sleep(deleteAfterMs);
}

await deleteWebhookMessage(webhookUrl, sentMessage.id);
console.log(`Sent and deleted WAKE UP message for ${targetUserId}.`);

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

function parseUserIds(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((userId) => userId.trim())
    .filter(Boolean)
    .map((userId) => {
      if (!/^\d{17,20}$/.test(userId)) {
        throw new Error(`Invalid Discord user ID: ${userId}`);
      }

      return userId;
    });
}

function parseChance(value) {
  const chance = Number(value);
  if (!Number.isFinite(chance) || chance < 0 || chance > 100) {
    throw new Error("WAKE_UP_CHANCE_PERCENT must be a number from 0 to 100.");
  }

  return chance;
}

function parseNonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function parseAllowedHours(value) {
  if (!value) return null;

  const hours = new Set();
  for (const rawPart of value.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    if (part.includes("-")) {
      const [start, end] = part.split("-").map((item) => Number(item));
      if (!isValidHour(start) || !isValidHour(end)) {
        throw new Error("WAKE_UP_ALLOWED_HOURS ranges must use hours from 0 to 23.");
      }

      if (start <= end) {
        for (let hour = start; hour <= end; hour += 1) {
          hours.add(hour);
        }
      } else {
        for (let hour = start; hour <= 23; hour += 1) {
          hours.add(hour);
        }
        for (let hour = 0; hour <= end; hour += 1) {
          hours.add(hour);
        }
      }
      continue;
    }

    const hour = Number(part);
    if (!isValidHour(hour)) {
      throw new Error("WAKE_UP_ALLOWED_HOURS must use hours from 0 to 23.");
    }
    hours.add(hour);
  }

  return hours;
}

function isValidHour(hour) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

function getLocalHour(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  });

  return Number(formatter.format(date));
}

function choose(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function sendWebhookMessage(webhookUrl, payload) {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook send failed: ${response.status} ${body}`);
  }

  return response.json();
}

async function deleteWebhookMessage(webhookUrl, messageId) {
  const url = new URL(webhookUrl);
  url.pathname = `${url.pathname}/messages/${messageId}`;
  url.search = "";

  const response = await fetch(url, {
    method: "DELETE",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook delete failed: ${response.status} ${body}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
