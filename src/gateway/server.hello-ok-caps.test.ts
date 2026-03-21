import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { GATEWAY_SERVER_CAPS } from "./protocol/client-info.js";
import { connectReq, getFreePort, openWs, startGatewayServer } from "./server.auth.shared.js";

describe("hello-ok capability advertisement", () => {
  let server: Awaited<ReturnType<typeof startGatewayServer>>;
  let port: number;

  beforeAll(async () => {
    port = await getFreePort();
    server = await startGatewayServer(port);
  });

  afterAll(async () => {
    await server.close();
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
