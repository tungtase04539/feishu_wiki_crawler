/**
 * SSE streaming endpoint for wiki crawl with real-time progress.
 * GET /api/wiki/crawl-stream?url=...&token=...&appId=...&appSecret=...
 *
 * Streams Server-Sent Events:
 *   { type: "progress", count: number, message: string }
 *   { type: "done", spaceId, domain, totalCount, nodes, treeAvailable }
 *   { type: "error", message: string }
 */

import type { Express, Request, Response } from "express";
import {
  parseFeishuWikiUrl,
  getTenantAccessToken,
  getWikiNodeInfo,
  fetchAllNodes,
  buildTree,
  type FeishuNode,
} from "./feishuApi";

function sendEvent(res: Response, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerWikiCrawlRoute(app: Express) {
  app.get("/api/wiki/crawl-stream", async (req: Request, res: Response) => {
    const { url, userAccessToken, appId, appSecret } = req.query as Record<string, string>;

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Keep-alive ping every 15s
    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    const cleanup = () => clearInterval(keepAlive);

    try {
      // Validate URL
      if (!url) {
        sendEvent(res, { type: "error", message: "Missing url parameter" });
        cleanup();
        res.end();
        return;
      }

      const parsed = parseFeishuWikiUrl(url);
      if (!parsed.isValid) {
        sendEvent(res, {
          type: "error",
          message: "Invalid Feishu wiki URL. Please enter a valid URL like: https://xxx.feishu.cn/wiki/TOKEN",
        });
        cleanup();
        res.end();
        return;
      }

      const hasAppCreds = appId && appSecret;
      const hasUserToken = userAccessToken && userAccessToken.trim().length > 0;

      if (!hasAppCreds && !hasUserToken) {
        sendEvent(res, {
          type: "error",
          message:
            "Authentication required. Please provide either:\n" +
            "1. Feishu App ID + App Secret\n" +
            "2. User Access Token",
        });
        cleanup();
        res.end();
        return;
      }

      const { domain, token } = parsed;

      // Get access token
      sendEvent(res, { type: "progress", count: 0, message: "Authenticating with Feishu..." });

      let accessToken: string;
      try {
        if (hasUserToken) {
          accessToken = userAccessToken!.trim();
        } else {
          accessToken = await getTenantAccessToken(appId!, appSecret!);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(res, { type: "error", message: `Authentication failed: ${msg}` });
        cleanup();
        res.end();
        return;
      }

      // Resolve space_id
      sendEvent(res, { type: "progress", count: 0, message: "Resolving wiki space..." });

      let spaceId: string;
      let rootNodeToken: string | undefined;

      try {
        const nodeInfo = await getWikiNodeInfo(token, accessToken);
        if (nodeInfo) {
          spaceId = nodeInfo.space_id;
          rootNodeToken = nodeInfo.node_token;
        } else {
          spaceId = token;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("TOKEN_EXPIRED")) {
          sendEvent(res, {
            type: "error",
            message:
              "Your User Access Token has expired (tokens expire after 2 hours).\n\n" +
              "Please get a new token from https://open.feishu.cn/api-explorer",
          });
        } else {
          sendEvent(res, { type: "error", message: `Could not access wiki: ${msg}` });
        }
        cleanup();
        res.end();
        return;
      }

      // Fetch all nodes with progress
      sendEvent(res, { type: "progress", count: 0, message: "Starting concurrent fetch..." });

      let lastReported = 0;
      const allNodes: FeishuNode[] = [];

      try {
        const nodes = await fetchAllNodes(
          spaceId,
          accessToken,
          domain,
          rootNodeToken,
          0,
          (count) => {
            allNodes.length = 0; // not used here, progress only
            // Report every 50 nodes to avoid flooding
            if (count - lastReported >= 50 || count === 1) {
              lastReported = count;
              sendEvent(res, {
                type: "progress",
                count,
                message: `Fetching nodes... ${count} found`,
              });
            }
          }
        );

        if (nodes.length === 0) {
          sendEvent(res, {
            type: "error",
            message:
              "No pages found in this wiki space.\n\n" +
              "This could mean:\n" +
              "• The wiki space is empty\n" +
              "• Your app doesn't have permission to view the pages\n" +
              "• The wiki token in the URL is incorrect",
          });
          cleanup();
          res.end();
          return;
        }

        sendEvent(res, {
          type: "progress",
          count: nodes.length,
          message: `Building tree structure for ${nodes.length} nodes...`,
        });

        // Only build tree for reasonable sizes
        const treeAvailable = nodes.length <= 5000;
        const tree = treeAvailable ? buildTree(nodes) : [];

        sendEvent(res, {
          type: "done",
          spaceId,
          domain,
          totalCount: nodes.length,
          nodes,
          tree,
          treeAvailable,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("TOKEN_EXPIRED")) {
          sendEvent(res, {
            type: "error",
            message:
              "Your User Access Token has expired (tokens expire after 2 hours).\n\n" +
              "Please get a new token from https://open.feishu.cn/api-explorer",
          });
        } else {
          sendEvent(res, { type: "error", message: `Failed to fetch wiki nodes: ${msg}` });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendEvent(res, { type: "error", message: `Unexpected error: ${msg}` });
    } finally {
      cleanup();
      res.end();
    }
  });
}
