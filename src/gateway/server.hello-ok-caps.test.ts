import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { GATEWAY_SERVER_CAPS } from "./protocol/client-info.js";
import {
  connectReq,
  getFreePort,
  openWs,
  startGatewayServer,
  testState,
} from "./server.auth.shared.js";

describe("hello-ok capability advertisement", () => {
  let server: Awaited<ReturnType<typeof startGatewayServer>>;
  let port: number;
  let prevToken: string | undefined;

  beforeAll(async () => {
    prevToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    testState.gatewayAuth = { mode: "token", token: "secret" };
    process.env.OPENCLAW_GATEWAY_TOKEN = "secret";
    port = await getFreePort();
    server = await startGatewayServer(port);
  });

  afterAll(async () => {
    await server.close();
    if (prevToken === undefined) {
      delete process.env.OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
    }
  });

  test("advertises only the voice-turn server capability", async () => {
    const ws = await openWs(port);

    try {
      const res = await connectReq(ws);
      expect(res.ok).toBe(true);

      const payload = res.payload as { type?: unknown; caps?: string[] } | undefined;
      expect(payload?.type).toBe("hello-ok");
      expect(payload?.caps).toEqual([GATEWAY_SERVER_CAPS.VOICE_TURNS]);
    } finally {
      ws.close();
    }
  });
});
