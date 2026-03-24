/**
 * Discord History MCP Server — SSE transport for GoClaw integration.
 * Exposes tools: discord_read_history, discord_list_channels, discord_search.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";
import {
  fetchChannelMessages,
  listGuildChannels,
  searchMessages,
} from "./discord-api.js";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API_SECRET = process.env.API_SECRET || "";
const PORT = process.env.PORT || 3000;

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
    guild_id: z.string().describe("Discord server/guild ID"),
  },
  async ({ guild_id }) => {
    const channels = await listGuildChannels(DISCORD_BOT_TOKEN, guild_id);
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
    guild_id: z.string().describe("Discord server/guild ID"),
    query: z.string().describe("Search keyword"),
  },
  async ({ guild_id, query }) => {
    const messages = await searchMessages(DISCORD_BOT_TOKEN, guild_id, query);
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

// --- Express + SSE transport ---

const app = express();

// Auth middleware — validates API_SECRET if set
app.use((req, res, next) => {
  if (API_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${API_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  next();
});

// Health check endpoint
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// SSE transport — stores transports by session for message routing
const transports = {};

app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) return res.status(400).json({ error: "Unknown session" });
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`Discord History MCP server running on port ${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
});
