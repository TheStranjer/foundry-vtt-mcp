import { EventEmitter } from "events";
import { FoundryClient } from "../src/foundry-client.js";

type Responder = (req: any, callback: (res: any) => void) => void;

function transport(respond: Responder) {
  return {
    request: jest.fn((_options: unknown, callback: (res: any) => void) => {
      const req = new EventEmitter() as any;
      req.write = jest.fn();
      req.destroy = jest.fn((error: Error) => req.emit("error", error));
      req.end = jest.fn(() => respond(req, callback));
      return req;
    }),
  };
}

function createClient(deps: Record<string, unknown> = {}) {
  return new FoundryClient("/tmp/creds.json", {
    logger: { error: jest.fn() },
    wsLogger: { logInbound: jest.fn(), logOutbound: jest.fn(), close: jest.fn() },
    ...deps,
  } as any) as any;
}

const silent: Responder = (req) => req.emit("timeout");

const reply = (status: number, chunks: Array<string | Buffer>, headers = {}): Responder =>
  (_req, callback) => {
    const res = new EventEmitter() as any;
    res.statusCode = status;
    res.headers = headers;
    callback(res);
    chunks.forEach((chunk) => res.emit("data", chunk));
    res.emit("end");
  };

const connect = (client: any) => {
  client.connection = {
    hostname: "host",
    credential: { _id: "c", hostname: "host", password: "p", userid: "u" },
    sessionId: "sid",
  };
};

describe("httpsRequest", () => {
  test("collects the body, status and headers", async () => {
    const https = transport(reply(201, ["he", Buffer.from("llo")], { "x-a": "b" }));
    const client = createClient({ https });

    const res = await client.httpsRequest({ hostname: "h", path: "/p", method: "GET" });

    expect(res.statusCode).toBe(201);
    expect(res.headers).toEqual({ "x-a": "b" });
    expect(res.body).toEqual(Buffer.from("hello"));
  });

  test("uses port 443 and the default timeout, without disabling TLS checks", async () => {
    const https = transport(reply(200, []));
    const client = createClient({ https });

    await client.httpsRequest({ hostname: "h", path: "/p", method: "GET" });

    const [options] = https.request.mock.calls[0] as [any];
    expect(options).toMatchObject({ hostname: "h", port: 443, path: "/p", method: "GET", timeout: 10000 });
    expect(options).not.toHaveProperty("rejectUnauthorized");
  });

  test("passes the insecure-TLS flag through", async () => {
    const https = transport(reply(200, []));
    const client = createClient({ https });

    await client.httpsRequest({ hostname: "h", path: "/p", method: "GET", allowInsecureTls: true });

    expect(https.request.mock.calls[0][0]).toMatchObject({ rejectUnauthorized: false });
  });

  test("writes the body with its Content-Length and keeps given headers", async () => {
    let written: unknown;
    const https = transport((req, callback) => {
      written = req.write.mock.calls[0][0];
      reply(200, [])(req, callback);
    });
    const client = createClient({ https });

    await client.httpsRequest({
      hostname: "h", path: "/p", method: "POST", body: "héllo", headers: { Cookie: "a=b" },
    });

    expect(written).toBe("héllo");
    expect(https.request.mock.calls[0][0]).toMatchObject({
      headers: { Cookie: "a=b", "Content-Length": Buffer.byteLength("héllo") },
    });
  });

  test("a silent request is destroyed with a no-response error", async () => {
    let request: any;
    const https = transport((req) => {
      request = req;
      req.emit("timeout");
    });
    const client = createClient({ https });

    await expect(client.httpsRequest({ hostname: "h", path: "/p", method: "GET" }))
      .rejects.toThrow("no response for 10s");
    expect(request.destroy).toHaveBeenCalledTimes(1);
  });

  test("the timeout is configurable", async () => {
    const https = transport(silent);
    const client = createClient({ https });

    await expect(client.httpsRequest({ hostname: "h", path: "/p", method: "GET", timeoutMs: 60000 }))
      .rejects.toThrow("no response for 60s");
    expect(https.request.mock.calls[0][0]).toMatchObject({ timeout: 60000 });
  });

  test("a request error rejects", async () => {
    const https = transport((req) => req.emit("error", new Error("refused")));
    const client = createClient({ https });

    await expect(client.httpsRequest({ hostname: "h", path: "/p", method: "GET" }))
      .rejects.toThrow("refused");
  });

  test("a response error rejects", async () => {
    const https = transport((_req, callback) => {
      const res = new EventEmitter();
      callback(res);
      res.emit("error", new Error("aborted"));
    });
    const client = createClient({ https });

    await expect(client.httpsRequest({ hostname: "h", path: "/p", method: "GET" }))
      .rejects.toThrow("aborted");
  });

  test("the http protocol goes through the injected http, on port 80", async () => {
    const http = transport(reply(200, ["x"]));
    const https = transport(reply(200, []));
    const client = createClient({ http, https });

    const res = await client.httpsRequest({ hostname: "h", path: "/p", method: "GET", protocol: "http" });

    expect(res.body.toString()).toBe("x");
    expect(https.request).not.toHaveBeenCalled();
    expect(http.request.mock.calls[0][0]).toMatchObject({ port: 80 });
    expect(http.request.mock.calls[0][0]).not.toHaveProperty("rejectUnauthorized");
  });
});

describe("uploadFile", () => {
  const upload = (client: any) =>
    client.uploadFile({ target: "t", filename: "a.png", image_data: "aGVsbG8=" });

  test("rejects when the server goes silent, using the transfer timeout", async () => {
    const https = transport(silent);
    const client = createClient({ https });
    connect(client);

    await expect(upload(client)).rejects.toThrow("Upload request failed: no response for 60s");
    expect(https.request.mock.calls[0][0]).toMatchObject({ timeout: 60000 });
  });
});

describe("downloadFile", () => {
  test("rejects when the server goes silent, using the transfer timeout", async () => {
    const https = transport(silent);
    const client = createClient({ https });

    await expect(client.downloadFile("https://example.com/a.png"))
      .rejects.toThrow("Failed to download file: no response for 60s");
    expect(https.request.mock.calls[0][0]).toMatchObject({ timeout: 60000 });
  });

  test("rejects when a plain http server goes silent", async () => {
    const http = transport(silent);
    const client = createClient({ http });

    await expect(client.downloadFile("http://example.com/a.png"))
      .rejects.toThrow("Failed to download file: no response for 60s");
    expect(http.request.mock.calls[0][0]).toMatchObject({ port: 80 });
  });

  test("returns the body and content type over http, honoring the URL port", async () => {
    const http = transport(reply(200, ["png"], { "content-type": "image/png" }));
    const client = createClient({ http });

    const result = await client.downloadFile("http://example.com:8080/a.png?x=1");

    expect(result).toEqual({ buffer: Buffer.from("png"), contentType: "image/png" });
    expect(http.request.mock.calls[0][0]).toMatchObject({
      hostname: "example.com", port: "8080", path: "/a.png?x=1",
    });
  });

  test("follows a redirect from http to https", async () => {
    const http = transport(reply(302, [], { location: "https://cdn.example.com/b.png" }));
    const https = transport(reply(200, ["b"]));
    const client = createClient({ http, https });

    const result = await client.downloadFile("http://example.com/a.png");

    expect(result.buffer.toString()).toBe("b");
    expect(result.contentType).toBe("application/octet-stream");
    expect(https.request.mock.calls[0][0]).toMatchObject({ hostname: "cdn.example.com", path: "/b.png" });
  });

  test("rejects on a non-2xx status", async () => {
    const https = transport(reply(404, []));
    const client = createClient({ https });

    await expect(client.downloadFile("https://example.com/a.png"))
      .rejects.toThrow("Failed to download file: HTTP 404");
  });

  test("rejects on a request error", async () => {
    const https = transport((req) => req.emit("error", new Error("refused")));
    const client = createClient({ https });

    await expect(client.downloadFile("https://example.com/a.png"))
      .rejects.toThrow("Failed to download file: refused");
  });
});
