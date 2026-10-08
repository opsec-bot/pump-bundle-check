import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buysIn, creatorOf, isCreation } from "../src/launch.js";
import type { ParsedTx } from "../src/swaps.js";

// Real mainnet transactions around the launch of 8U8o...pump (and another token), saved 2026-10-08.
const { transactions } = JSON.parse(readFileSync(new URL("./fixtures/sandwiches-pumpfun.json", import.meta.url), "utf8")) as {
  transactions: (ParsedTx & { transactionIndex: number })[];
};
const MINT = "8U8oQC8dh3c1UxjBr2Yc1Q8tBrueKwBpnqqVobVFpump";
const CREATE = "5VQKk4b7Z12XkrcUA3JR4C7XyKCSsMB4xTS1KmmywJrcTuezGqrQ583PhG2zBWxuPfkAx4fsX7sGZQuiDCVAwTzo";
const tx = (sig: string) => transactions.find((t) => t.transaction.signatures[0] === sig)!;

describe("launch parsing on real transactions", () => {
  it("finds the creation transaction and its creator", () => {
    expect(isCreation(tx(CREATE), MINT)).toBe(true);
    expect(creatorOf(tx(CREATE))).toBe("JCGjLMrCbFHExLUSiFvEVhdsKnth7YZowkHvpiCYWTuw");
    const later = transactions.find((t) => t.slot === 454659663 && t.transaction.signatures[0] !== CREATE)!;
    expect(isCreation(later, MINT)).toBe(false);
  });

  it("reads the creator's dev buy: 5% of supply for about 1.49 SOL", () => {
    const [b] = buysIn(tx(CREATE), MINT, 854, CREATE);
    expect(b!.wallet).toBe("JCGjLMrCbFHExLUSiFvEVhdsKnth7YZowkHvpiCYWTuw");
    expect(b!.tokens).toBe(50_000_000);
    expect(b!.solSpent).toBeCloseTo(1.4939, 3);
    expect(b!.inCreateTx).toBe(true);
    expect(b!.buyersInTx).toBe(1);
  });

  it("reads later buys and ignores the sell", () => {
    const buys = transactions.filter((t) => t.slot === 454659663).flatMap((t) => buysIn(t, MINT, t.transactionIndex, CREATE));
    expect(buys).toHaveLength(5);
    const sell = transactions.find((t) => t.slot === 454659664)!;
    expect(buysIn(sell, MINT, sell.transactionIndex, CREATE)).toEqual([]);
  });
});
