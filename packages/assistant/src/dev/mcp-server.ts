/**
 * Runs the MCP server against the mock scene so you can point any MCP client at it.
 *   npm run mcp
 */
import { startMcpServer } from "../mcp/server";
import { MockSceneController } from "../mock/mock-scene";

const ctl = new MockSceneController();
const server = await startMcpServer({
  controller: ctl,
  port: Number(process.env.PORT ?? 0),
  onToolCall: (name, args, ok) => console.log(`${ok ? "✓" : "✗"} ${name} ${JSON.stringify(args)}`),
});
console.log(JSON.stringify({ url: server.url, token: server.token }));
process.on("SIGINT", () => void server.close().then(() => process.exit(0)));
