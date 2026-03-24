/**
 * Discord API client — lightweight wrapper for reading channel messages.
 * Uses Discord REST API v10 directly (no discord.js dependency needed).
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Wrapper for Discord API fetch with rate limit handling and logging.
 * Retries once after rate limit delay.
 */
async function discordFetch(url, options = {}) {
  console.log(`[Discord API] ${options.method || "GET"} ${url.replace(DISCORD_API_BASE, "")}`);

  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bot ${options.botToken}`, ...options.headers },
  });

  // Handle rate limit — wait and retry once
  if (res.status === 429) {
    const data = await res.json();
    const retryAfter = (data.retry_after || 1) * 1000;
    console.warn(`[Discord API] Rate limited! Waiting ${retryAfter}ms...`);
    await new Promise((r) => setTimeout(r, retryAfter));

    const retryRes = await fetch(url, {
      ...options,
      headers: { Authorization: `Bot ${options.botToken}`, ...options.headers },
    });
    console.log(`[Discord API] Retry ${retryRes.status}`);
    return retryRes;
  }

  console.log(`[Discord API] Response ${res.status}`);
  return res;
}

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

  const res = await discordFetch(url, { botToken });

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

  const res = await discordFetch(url, { botToken });

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

  const res = await discordFetch(url, { botToken });

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

/**
 * List members of a guild (server).
 * @param {string} botToken - Discord bot token
 * @param {string} guildId - Discord guild/server ID
 * @param {number} limit - Max members to fetch (max 1000)
 * @returns {Promise<Array>} Array of members with roles
 */
export async function listGuildMembers(botToken, guildId, limit = 100) {
  const clampedLimit = Math.min(Math.max(limit, 1), 1000);
  const url = `${DISCORD_API_BASE}/guilds/${guildId}/members?limit=${clampedLimit}`;

  const res = await discordFetch(url, { botToken });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }

  const members = await res.json();

  return members.map((m) => ({
    id: m.user?.id,
    username: m.user?.username || "unknown",
    display_name: m.nick || m.user?.global_name || m.user?.username || "unknown",
    roles: m.roles || [],
    joined_at: m.joined_at,
    is_bot: m.user?.bot || false,
  }));
}

/**
 * Send a DM to a Discord user. Creates DM channel first, then sends message.
 * @param {string} botToken - Discord bot token
 * @param {string} userId - Discord user ID
 * @param {string} content - Message content
 * @returns {Promise<object>} Sent message object
 */
export async function sendDirectMessage(botToken, userId, content) {
  // Step 1: Create/get DM channel
  const dmRes = await discordFetch(`${DISCORD_API_BASE}/users/@me/channels`, {
    method: "POST",
    botToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!dmRes.ok) {
    const body = await dmRes.text();
    throw new Error(`Failed to create DM channel: ${dmRes.status}: ${body}`);
  }

  const dmChannel = await dmRes.json();

  // Step 2: Send message to DM channel
  const msgRes = await discordFetch(`${DISCORD_API_BASE}/channels/${dmChannel.id}/messages`, {
    method: "POST",
    botToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!msgRes.ok) {
    const body = await msgRes.text();
    throw new Error(`Failed to send DM: ${msgRes.status}: ${body}`);
  }

  return msgRes.json();
}

/**
 * Send a message to a Discord channel.
 * @param {string} botToken - Discord bot token
 * @param {string} channelId - Discord channel ID
 * @param {string} content - Message content
 * @returns {Promise<object>} Sent message object
 */
export async function sendChannelMessage(botToken, channelId, content) {
  const res = await discordFetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    botToken,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to send message: ${res.status}: ${body}`);
  }

  return res.json();
}
