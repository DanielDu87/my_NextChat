import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPClientLogger } from "./logger";
import {
  ListToolsResponse,
  McpRequestMessage,
  McpResponseMessageSchema,
  ServerConfig,
} from "./types";
import { z } from "zod";

const logger = new MCPClientLogger();

export async function createClient(
  id: string,
  config: ServerConfig,
): Promise<Client> {
  logger.info(`Creating client for ${id}...`);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env)
          .filter(([_, v]) => v !== undefined)
          .map(([k, v]) => [k, v as string]),
      ),
      ...(config.env || {}),
    },
  });

  const client = new Client(
    {
      name: `nextchat-mcp-client-${id}`,
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );
  await client.connect(transport);
  return client;
}

export async function removeClient(client: Client) {
  logger.info(`Removing client...`);
  await client.close();
}

export async function listTools(client: Client): Promise<ListToolsResponse> {
  return client.listTools();
}

export async function executeRequest(
  client: Client,
  request: McpRequestMessage,
): Promise<z.infer<typeof McpResponseMessageSchema>> {
  // MCP SDK 的 `Client extends Protocol<Request, Notification, Result>` 把
  // `request<T extends AnySchema>` 推过多层泛型后会报 "Type instantiation is
  // excessively deep and possibly infinite"（TS2589）。这里用具名 schema 替代
  // 原来的 `z.any()`，并把 request 方法签名收窄成本地具体函数，避免 TS 重新
  // 推断 `Protocol` 类的递归泛型。
  const requestWithSchema = client.request as unknown as (
    req: McpRequestMessage,
    schema: typeof McpResponseMessageSchema,
  ) => Promise<z.infer<typeof McpResponseMessageSchema>>;
  return requestWithSchema(request, McpResponseMessageSchema);
}
