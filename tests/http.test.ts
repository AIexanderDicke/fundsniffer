import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FundSnifferError } from "../src/errors.ts";
import { HttpClient, parseRetryAfter, type HttpClientOptions } from "../src/http.ts";
import { scriptedFetch } from "./support.ts";

const URL = "https://example.test/page";

function clientWith(
  steps: Parameters<typeof scriptedFetch>[0],
  options: Partial<HttpClientOptions> = {},
) {
  const fetchImpl = scriptedFetch(steps);
  return {
    client: new HttpClient({
      fetchImpl,
      minDelayMs: 0,
      retries: 2,
      sleep: async () => {},
      ...options,
    }),
    fetchImpl,
  };
}

describe("HttpClient retries", () => {
  it("retries a retryable failure and then succeeds", async () => {
    const slept: number[] = [];
    const { client, fetchImpl } = clientWith(
      [new Response(null, { status: 403 }), new Response("ok", { status: 200 })],
      { random: () => 0, sleep: async (ms) => void slept.push(ms) },
    );

    const response = await client.get(URL);

    assert.equal(response.text, "ok");
    assert.equal(fetchImpl.calls.length, 2);
    assert.deepEqual(slept, [500]);
  });

  it("gives up after the configured retries", async () => {
    const { client, fetchImpl } = clientWith([() => new Response(null, { status: 403 })], {
      retries: 1,
    });

    await assert.rejects(client.get(URL), (error: unknown) => {
      assert.ok(error instanceof FundSnifferError);
      assert.equal(error.code, "blocked");
      assert.equal(error.status, 403);
      return true;
    });
    assert.equal(fetchImpl.calls.length, 2);
  });

  it("maps 429 to a blocked error and retries it", async () => {
    const { client, fetchImpl } = clientWith([
      new Response(null, { status: 429 }),
      new Response("ok", { status: 200 }),
    ]);

    const response = await client.get(URL);

    assert.equal(response.text, "ok");
    assert.equal(fetchImpl.calls.length, 2);
  });

  it("does not retry terminal errors", async () => {
    const { client, fetchImpl } = clientWith([new Response(null, { status: 404 })]);

    const response = await client.get(URL);

    assert.equal(response.status, 404);
    assert.equal(fetchImpl.calls.length, 1);
  });

  it("honours the Retry-After header on a 429", async () => {
    const slept: number[] = [];
    const { client } = clientWith(
      [
        new Response(null, { status: 429, headers: { "retry-after": "2" } }),
        new Response("ok", { status: 200 }),
      ],
      { sleep: async (ms) => void slept.push(ms) },
    );

    const response = await client.get(URL);

    assert.equal(response.text, "ok");
    assert.deepEqual(slept, [2000]);
  });
});

describe("HttpClient response body", () => {
  it("maps an abort during the body read to a timeout", async () => {
    const aborted = {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => {
        const error = new Error("aborted");
        error.name = "TimeoutError";
        throw error;
      },
    } as unknown as Response;
    const { client } = clientWith([aborted]);

    await assert.rejects(client.get(URL), (error: unknown) => {
      assert.ok(error instanceof FundSnifferError);
      assert.equal(error.code, "timeout");
      return true;
    });
  });
});

describe("HttpClient throttle", () => {
  it("serialises concurrent requests through the politeness gap", async () => {
    const slept: number[] = [];
    const { client } = clientWith([() => new Response("ok")], {
      minDelayMs: 1000,
      sleep: async (ms) => void slept.push(ms),
    });

    await Promise.all([client.get(URL), client.get(URL), client.get(URL)]);

    assert.equal(slept.length, 2);
  });
});

describe("HttpClient cache", () => {
  it("revalidates with conditional headers and reuses the body on 304", async () => {
    const { client, fetchImpl } = clientWith(
      [
        new Response("v1", { status: 200, headers: { etag: '"abc"' } }),
        new Response(null, { status: 304 }),
      ],
      { cache: true },
    );

    const first = await client.get(URL);
    const second = await client.get(URL);

    assert.equal(first.text, "v1");
    assert.equal(second.text, "v1");
    assert.equal(second.stale, false);
    assert.equal(fetchImpl.headers[1]?.get("if-none-match"), '"abc"');
  });

  it("serves a stale body when the refresh fails", async () => {
    const { client } = clientWith(
      [new Response("v1", { status: 200 }), new Response(null, { status: 403 })],
      { cache: true },
    );

    await client.get(URL);
    const stale = await client.get(URL);

    assert.equal(stale.text, "v1");
    assert.equal(stale.stale, true);
  });

  it("does not cache when disabled", async () => {
    const { client } = clientWith([() => new Response("v1", { status: 200 })], { retries: 0 });

    const first = await client.get(URL);
    const second = await client.get(URL);

    assert.equal(first.stale, false);
    assert.equal(second.stale, false);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and rejects junk", () => {
    assert.equal(parseRetryAfter("2"), 2000);
    assert.equal(parseRetryAfter("0"), 0);
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter("nonsense"), undefined);
  });
});
