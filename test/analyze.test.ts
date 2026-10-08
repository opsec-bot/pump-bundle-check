import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, type LaunchData } from "../src/analyze.js";
import type { Buy } from "../src/launch.js";

// Collected live from mainnet for 8U8o...pump on 2026-10-08 by `collect`.
const real = JSON.parse(readFileSync(new URL("./fixtures/launch-8U8o.json", import.meta.url), "utf8")) as LaunchData;

describe("a real launch", () => {
  const r = analyze(real);

  it("flags only the creator, a 25 second old wallet that bought 5%", () => {
    expect(r.creatorAgeSec).toBe(25);
    expect(r.creatorFunder).toBe("99op4B7ftEikAdPpeHHsDfHivJm3r5tuoc3D9QnaSUgg");
    expect(r.insiders).toBe(1);
    expect(r.wallets[0]!.wallet).toBe(real.create.creator);
    expect(r.insiderBoughtShare).toBe(0.05);
    expect(r.insiderHeldShare).toBe(0);
    expect(r.verdict).toBe("medium");
  });

  it("keeps the snipers in the creation slot below the insider line and notes they are busy wallets", () => {
    const snipers = r.wallets.filter((w) => w.wallet !== real.create.creator);
    expect(snipers).toHaveLength(4);
    for (const s of snipers) {
      expect(s.insider).toBe(false);
      expect(s.evidence.map((e) => e.signal)).toEqual(["same_slot_as_create"]);
      expect(s.notes[0]).toMatch(/1000 transactions/);
    }
  });
});

describe("signals", () => {
  const create = { signature: "C", slot: 100, blockTime: 1000, creator: "dev" };
  const buy = (wallet: string, o: Partial<Buy> = {}): Buy => ({
    wallet,
    signature: `s-${wallet}`,
    slot: 101,
    txIndex: 0,
    blockTime: 1001,
    tokens: 10_000_000,
    solSpent: 0.3,
    inCreateTx: false,
    buyersInTx: 1,
    ...o,
  });
  const base = (buys: Buy[], extra: Partial<LaunchData> = {}): LaunchData => ({ mint: "M", supply: 1_000_000_000, create, buys, ...extra });
  const signals = (r: ReturnType<typeof analyze>, w: string) => r.wallets.find((x) => x.wallet === w)!.evidence.map((e) => e.signal);

  it("links wallets in the creation transaction and the same Jito bundle to the creator", () => {
    const r = analyze(
      base([buy("dev", { signature: "C", inCreateTx: true }), buy("a", { signature: "C", inCreateTx: true, buyersInTx: 2 }), buy("b", { signature: "B" })], {
        bundles: { C: "bundle1", B: "bundle1" },
      }),
    );
    expect(signals(r, "a")).toContain("in_create_tx");
    expect(signals(r, "b")).toEqual(["same_bundle_as_create"]);
    expect(r.groups).toEqual([{ id: 1, wallets: ["a", "b", "dev"] }]);
    expect(r.insiderBoughtShare).toBeCloseTo(0.03, 9);
    expect(r.verdict).toBe("low");
  });

  it("groups launch buyers by a shared funder, and by multi-buyer transactions", () => {
    const old = -1_000_000; // long-lived wallets, so no fresh_wallet signal
    const funding = { x: { funder: "F", firstSeen: old }, y: { funder: "F", firstSeen: old }, z: { funder: "F", firstSeen: old } };
    const r = analyze(base([buy("x"), buy("y"), buy("z"), buy("p", { signature: "T", buyersInTx: 2 }), buy("q", { signature: "T", buyersInTx: 2 })], { funding }));
    const x = r.wallets.find((w) => w.wallet === "x")!;
    expect(x.evidence[0]).toMatchObject({ signal: "shared_funder", weight: 0.4375 });
    expect(x.insider).toBe(false); // 0.4375 alone is under the line
    expect(signals(r, "p")).toEqual(["multi_buyer_tx"]);
    expect(r.groups).toEqual([{ id: 1, wallets: ["p", "q"] }]);
  });

  it("flags wallets the creator funded, and fresh wallets", () => {
    const r = analyze(base([buy("k")], { funding: { k: { funder: "dev", firstSeen: 990 } } }));
    expect(signals(r, "k")).toEqual(["funded_by_creator", "fresh_wallet"]);
    expect(r.wallets.find((w) => w.wallet === "k")!.score).toBeCloseTo(1 - 0.1 * 0.8, 9);
  });

  it("calls a launch high when insiders took 20% or more", () => {
    const r = analyze(base([buy("dev", { signature: "C", inCreateTx: true, tokens: 250_000_000 })]));
    expect(r.verdict).toBe("high");
    expect(r.insiderHeldShare).toBeNull(); // holdings unknown
  });
});
