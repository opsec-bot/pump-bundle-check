import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstSolSender, jitoBundle, mintHistory, walletFunding } from "../src/fetch.js";
import { Rpc } from "../src/rpc.js";
import type { ParsedTx } from "../src/swaps.js";

const { transactions } = JSON.parse(readFileSync(new URL("./fixtures/sandwiches-pumpfun.json", import.meta.url), "utf8")) as { transactions: ParsedTx[] };

function rpcWith(handler: (method: string, params: unknown[]) => unknown) {
  const fake = (async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body.method, body.params) }));
  }) as unknown as typeof fetch;
  return new Rpc("http://x", { fetch: fake });
}

describe("mintHistory", () => {
  const sigs = Array.from({ length: 2500 }, (_, i) => ({ signature: `s${2500 - i}`, slot: 2500 - i, blockTime: 0, err: null }));
  const rpc = rpcWith((_m, params) => {
    const { limit, before } = params[1] as { limit: number; before?: string };
    const start = before ? sigs.findIndex((s) => s.signature === before) + 1 : 0;
    return sigs.slice(start, start + limit);
  });

  it("pages back to the oldest signature and returns oldest first", async () => {
    const h = await mintHistory(rpc, "M", 3000);
    expect(h).toHaveLength(2500);
    expect(h[0]!.signature).toBe("s1");
  });

  it("refuses when the history is longer than the cap", async () => {
    await expect(mintHistory(rpc, "M", 2000)).rejects.toThrow(/more than 2000/);
  });
});

describe("funding", () => {
  it("reads who sent SOL to a wallet in a real transaction", () => {
    // A pump.fun buy: the buyer sends SOL to the bonding curve.
    const buy = transactions[1]!;
    const buyer = buy.transaction.message.accountKeys[0]!.pubkey;
    const curve = buy.meta!.innerInstructions!.flatMap((g) => g.instructions).find(
      (i) => typeof i.parsed === "object" && i.parsed.type === "transfer" && i.parsed.info?.source === buyer,
    )!;
    const dest = (curve.parsed as { info: { destination: string } }).info.destination;
    expect(firstSolSender(buy, dest)).toBe(buyer);
    expect(firstSolSender(buy, "nobody")).toBeNull();
  });

  it("marks wallets with 1000+ transactions as busy instead of tracing them", async () => {
    const rpc = rpcWith(() => Array.from({ length: 1000 }, (_, i) => ({ signature: `x${i}`, slot: i, blockTime: i, err: null })));
    expect(await walletFunding(rpc, "W")).toEqual({ funder: null, firstSeen: null, busy: true });
  });
});

describe("jitoBundle", () => {
  it("returns the bundle id, or null on 404", async () => {
    const ok = (async () => new Response(JSON.stringify([{ bundle_id: "abc" }]))) as unknown as typeof fetch;
    const missing = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    expect(await jitoBundle("sig", ok)).toBe("abc");
    expect(await jitoBundle("sig", missing)).toBeNull();
  });
});
