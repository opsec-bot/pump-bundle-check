import type { ParsedTx } from "./swaps.js";

export interface RpcOptions {
  /** Retries for HTTP 429 and 5xx. */
  retries?: number;
  fetch?: typeof fetch;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
}

export interface ParsedBlock {
  blockTime: number | null;
  transactions: Omit<ParsedTx, "slot" | "blockTime">[];
}

/**
 * Minimal Solana JSON-RPC client. Asks for transaction version 1, since mainnet carries v1 transactions and a
 * request that only allows v0 fails on any block or transaction that contains one.
 */
export class Rpc {
  private id = 0;
  private readonly retries: number;
  private readonly fetchFn: typeof fetch;

  constructor(readonly url: string, opts: RpcOptions = {}) {
    this.retries = opts.retries ?? 8;
    this.fetchFn = opts.fetch ?? fetch;
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(10_000, 500 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      if (body.error) throw new Error(`${method}: ${body.error.message}`);
      return body.result as T;
    }
  }

  getSlot(): Promise<number> {
    return this.call("getSlot", [{ commitment: "finalized" }]);
  }

  /** Slots that have blocks in [start, end]. */
  getBlocks(start: number, end: number): Promise<number[]> {
    return this.call("getBlocks", [start, end, { commitment: "finalized" }]);
  }

  /** A full block with its transactions in order, each stamped with slot and blockTime. Null if the slot was skipped. */
  async getBlock(slot: number): Promise<ParsedTx[] | null> {
    const b = await this.call<ParsedBlock | null>("getBlock", [
      slot,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, transactionDetails: "full", rewards: false, commitment: "finalized" },
    ]);
    if (!b) return null;
    return b.transactions.map((t) => ({ ...t, slot, blockTime: b.blockTime }));
  }

  getTransaction(signature: string): Promise<ParsedTx | null> {
    return this.call("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "finalized" }]);
  }

  getSignaturesForAddress(address: string, opts: { limit?: number; before?: string; until?: string } = {}): Promise<SignatureInfo[]> {
    return this.call("getSignaturesForAddress", [address, { limit: 1000, ...opts, commitment: "finalized" }]);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Runs `fn` over `items` with at most `size` in flight, keeping results in input order. */
export async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
