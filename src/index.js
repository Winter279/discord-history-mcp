/**
 * Discord History MCP Server — SSE transport for GoClaw integration.
 * Exposes tools: discord_read_history, discord_list_channels, discord_search.
 */

// Load .env file for local development (dotenv optional — Render injects env vars)
try { await import("dotenv/config"); } catch {}
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import {
  fetchChannelMessages,
  listGuildChannels,
  listGuildMembers,
  searchMessages,
  sendDirectMessage,
  sendChannelMessage,
} from "./discord-api.js";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_SECRET = process.env.API_SECRET || "";
const PORT = process.env.PORT || 3000;
const DEFAULT_GUILD_ID = process.env.DEFAULT_GUILD_ID || "";

if (!DISCORD_BOT_TOKEN) {
  console.error("DISCORD_BOT_TOKEN env var is required");
  process.exit(1);
}

// --- MCP Server setup ---

const server = new McpServer({
  name: "discord-history",
  version: "1.0.0",
});

// Tool: Read channel message history
server.tool(
  "discord_read_history",
  "Read recent messages from a Discord channel. Returns messages in chronological order.",
  {
    channel_id: z.string().describe("Discord channel ID"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(50)
      .describe("Number of messages to fetch (1-100, default 50)"),
  },
  async ({ channel_id, limit }) => {
    const messages = await fetchChannelMessages(
      DISCORD_BOT_TOKEN,
      channel_id,
      limit
    );
    const formatted = messages
      .map(
        (m) =>
          `[${m.timestamp}] ${m.author}: ${m.content}${m.attachments > 0 ? ` (${m.attachments} file)` : ""}`
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: formatted || "No messages found.",
        },
      ],
    };
  }
);

// Tool: List text channels in a server
server.tool(
  "discord_list_channels",
  "List all text channels in a Discord server/guild.",
  {
    guild_id: z.string().optional().describe("Discord server/guild ID (uses DEFAULT_GUILD_ID if omitted)"),
  },
  async ({ guild_id }) => {
    const gid = guild_id || DEFAULT_GUILD_ID;
    if (!gid) return { content: [{ type: "text", text: "Error: guild_id required (no DEFAULT_GUILD_ID set)" }] };
    const channels = await listGuildChannels(DISCORD_BOT_TOKEN, gid);
    const formatted = channels
      .map((ch) => `#${ch.name} (ID: ${ch.id})${ch.topic ? ` — ${ch.topic}` : ""}`)
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: formatted || "No text channels found.",
        },
      ],
    };
  }
);

// Tool: Search messages by keyword
server.tool(
  "discord_search",
  "Search messages in a Discord server by keyword.",
  {
    guild_id: z.string().optional().describe("Discord server/guild ID (uses DEFAULT_GUILD_ID if omitted)"),
    query: z.string().describe("Search keyword"),
  },
  async ({ guild_id, query }) => {
    const gid = guild_id || DEFAULT_GUILD_ID;
    if (!gid) return { content: [{ type: "text", text: "Error: guild_id required (no DEFAULT_GUILD_ID set)" }] };
    const messages = await searchMessages(DISCORD_BOT_TOKEN, gid, query);
    const formatted = messages
      .map(
        (m) =>
          `[${m.timestamp}] ${m.author} in <#${m.channel_id}>: ${m.content}`
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: formatted || "No matching messages found.",
        },
      ],
    };
  }
);

// Tool: List server members with roles
server.tool(
  "discord_list_members",
  "List all members in a Discord server/guild with their roles.",
  {
    guild_id: z.string().optional().describe("Discord server/guild ID (uses DEFAULT_GUILD_ID if omitted)"),
    limit: z.number().min(1).max(1000).default(100).describe("Max members (1-1000)"),
  },
  async ({ guild_id, limit }) => {
    const gid = guild_id || DEFAULT_GUILD_ID;
    if (!gid) return { content: [{ type: "text", text: "Error: guild_id required (no DEFAULT_GUILD_ID set)" }] };
    const members = await listGuildMembers(DISCORD_BOT_TOKEN, gid, limit);
    const formatted = members
      .map(
        (m) =>
          `${m.display_name} (@${m.username}, ID: ${m.id})${m.is_bot ? " [BOT]" : ""}${m.roles.length > 0 ? ` — roles: ${m.roles.join(", ")}` : ""}`
      )
      .join("\n");

    return {
      content: [{ type: "text", text: formatted || "No members found." }],
    };
  }
);

// Tool: Send DM to a user
server.tool(
  "discord_send_dm",
  "Send a direct message to a Discord user by their user ID.",
  {
    user_id: z.string().describe("Discord user ID"),
    content: z.string().describe("Message content to send"),
  },
  async ({ user_id, content }) => {
    await sendDirectMessage(DISCORD_BOT_TOKEN, user_id, content);
    return {
      content: [{ type: "text", text: `DM sent to user ${user_id}.` }],
    };
  }
);

// Tool: Send message to a channel
server.tool(
  "discord_send_message",
  "Send a message to a Discord channel.",
  {
    channel_id: z.string().describe("Discord channel ID"),
    content: z.string().describe("Message content to send"),
  },
  async ({ channel_id, content }) => {
    await sendChannelMessage(DISCORD_BOT_TOKEN, channel_id, content);
    return {
      content: [{ type: "text", text: `Message sent to channel ${channel_id}.` }],
    };
  }
);

// --- Express + SSE transport ---

const app = express();

// Health check endpoint (no auth required) — shows config status
app.get("/health", (_req, res) => res.json({
  status: "ok",
  api_secret_set: !!API_SECRET,
  default_guild_id_set: !!DEFAULT_GUILD_ID,
  bot_token_set: !!DISCORD_BOT_TOKEN,
}));

// Auth middleware — no-op (auth handled by deployment platform)
const authMiddleware = (_req, _res, next) => next();

// SSE transport — stores transports by session for message routing
const transports = {};

app.get("/sse", authMiddleware, async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await server.connect(transport);
});

app.post("/messages", authMiddleware, async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) return res.status(400).json({ error: "Unknown session" });
  await transport.handlePostMessage(req, res);
});

// Streamable HTTP transport — single endpoint for GoClaw streamable-http
app.post("/mcp", authMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.listen(PORT, () => {
  console.log(`Discord History MCP server running on port ${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`Streamable HTTP endpoint: http://localhost:${PORT}/mcp`);

  // Self-ping every 10 min to prevent Render free tier from sleeping
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(() => {
      fetch(`${process.env.RENDER_EXTERNAL_URL}/health`).catch(() => {});
    }, 10 * 60 * 1000);
    console.log("Self-ping enabled (Render keep-alive)");
  }
});
