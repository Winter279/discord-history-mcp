/**
 * Discord API client — lightweight wrapper for reading channel messages.
 * Uses Discord REST API v10 directly (no discord.js dependency needed).
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Fetch messages from a Discord channel.
 * @param {string} botToken - Discord bot token
 * @param {string} channelId - Discord channel ID
 * @param {number} limit - Number of messages to fetch (max 100)
 * @returns {Promise<Array>} Array of formatted messages
 */
export async function fetchChannelMessages(botToken, channelId, limit = 50) {
  const clampedLimit = Math.min(Math.max(limit, 1), 100);
  const url = `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${clampedLimit}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }

  const messages = await res.json();

  // Format messages for LLM consumption (newest first → reverse to chronological)
  return messages.reverse().map((msg) => ({
    id: msg.id,
    author: msg.author?.global_name || msg.author?.username || "unknown",
    content: msg.content || "(no text)",
    timestamp: msg.timestamp,
    attachments: msg.attachments?.length || 0,
  }));
}

/**
 * List all text channels in a guild (server).
 * @param {string} botToken - Discord bot token
 * @param {string} guildId - Discord guild/server ID
 * @returns {Promise<Array>} Array of text channels
 */
export async function listGuildChannels(botToken, guildId) {
  const url = `${DISCORD_API_BASE}/guilds/${guildId}/channels`;

  const res = await fetch(url, {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }

  const channels = await res.json();

  // Filter text channels only (type 0 = text, type 5 = announcement)
  return channels
    .filter((ch) => ch.type === 0 || ch.type === 5)
    .map((ch) => ({
      id: ch.id,
      name: ch.name,
      topic: ch.topic || "",
      category: ch.parent_id || null,
    }));
}

/**
 * Search messages in a guild by content keyword.
 * @param {string} botToken - Discord bot token
 * @param {string} guildId - Discord guild/server ID
 * @param {string} query - Search keyword
 * @returns {Promise<Array>} Array of matching messages
 */
export async function searchMessages(botToken, guildId, query) {
  const url = `${DISCORD_API_BASE}/guilds/${guildId}/messages/search?content=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }

  const data = await res.json();

  return (data.messages || []).flat().map((msg) => ({
    id: msg.id,
    author: msg.author?.global_name || msg.author?.username || "unknown",
    content: msg.content || "(no text)",
    channel_id: msg.channel_id,
    timestamp: msg.timestamp,
  }));
}
