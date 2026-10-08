import type { Buy } from "./launch.js";
import { gini, hhi, round } from "./stats.js";

export type SignalName =
  | "creator"
  | "in_create_tx"
  | "funded_by_creator"
  | "same_bundle_as_create"
  | "multi_buyer_tx"
  | "shared_funder"
  | "same_slot_as_create"
  | "fresh_wallet";

export interface Evidence {
  signal: SignalName;
  weight: number;
  summary: string;
  /** Signatures or addresses behind it. */
  refs: string[];
}

export interface Funding {
  /** Sender of the first SOL the wallet received, or null if unknown. */
  funder: string | null;
  /** Unix time of the wallet's first transaction, or null if unknown. */
  firstSeen: number | null;
  /** True when the wallet has 1000+ transactions, so its first funding was not traced. Often a trading bot. */
  busy?: boolean;
}

export interface LaunchData {
  mint: string;
  supply: number;
  create: { signature: string; slot: number; blockTime: number; creator: string };
  buys: Buy[];
  /** Jito bundle id per signature, where known. */
  bundles?: Record<string, string | null>;
  funding?: Record<string, Funding>;
  /** Current balance of the mint per wallet, where known. */
  holdings?: Record<string, number>;
}

export interface WalletResult {
  wallet: string;
  score: number;
  insider: boolean;
  tokensBought: number;
  solSpent: number;
  holding: number | null;
  group: number | null;
  evidence: Evidence[];
  notes: string[];
}

export interface Report {
  mint: string;
  creator: string;
  createSignature: string;
  createSlot: number;
  /** Who first funded the creator, and how old the creator's wallet was at creation, in seconds. */
  creatorFunder: string | null;
  creatorAgeSec: number | null;
  supply: number;
  launchBuyers: number;
  launchTokens: number;
  insiders: number;
  insiderBoughtShare: number;
  insiderHeldShare: number | null;
  verdict: "low" | "medium" | "high";
  concentration: { hhi: number; gini: number };
  groups: { id: number; wallets: string[] }[];
  wallets: WalletResult[];
}

const FRESH_SEC = 3600;

/** Scores launch buyers. Pure: the same data always gives the same report. */
export function analyze(d: LaunchData, insiderThreshold = 0.5): Report {
  const { create } = d;
  const creator = create.creator;
  const bundles = d.bundles ?? {};
  const funding = d.funding ?? {};
  const createBundle = bundles[create.signature] ?? null;

  // Merge each wallet's buys.
  const byWallet = new Map<string, Buy[]>();
  for (const b of d.buys) byWallet.set(b.wallet, [...(byWallet.get(b.wallet) ?? []), b]);
  if (!byWallet.has(creator)) byWallet.set(creator, []);

  // Launch buyers per first funder.
  const byFunder = new Map<string, string[]>();
  for (const w of byWallet.keys()) {
    const f = funding[w]?.funder;
    if (f && f !== creator) byFunder.set(f, [...(byFunder.get(f) ?? []), w]);
  }

  // Groups: union-find over shared transactions, shared bundles with creation, creator funding, shared funders.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  const results: WalletResult[] = [];
  for (const [wallet, buys] of byWallet) {
    const ev: Evidence[] = [];
    const sigs = buys.map((b) => b.signature);
    if (wallet === creator) ev.push({ signal: "creator", weight: 1, summary: "Created the token.", refs: [create.signature] });
    if (buys.some((b) => b.inCreateTx) && wallet !== creator) {
      ev.push({ signal: "in_create_tx", weight: 0.9, summary: "Bought inside the creation transaction.", refs: [create.signature] });
      union(wallet, creator);
    }
    if (funding[wallet]?.funder === creator && wallet !== creator) {
      ev.push({ signal: "funded_by_creator", weight: 0.9, summary: `First SOL came from the creator ${creator}.`, refs: [creator] });
      union(wallet, creator);
    }
    const bundled = buys.filter((b) => createBundle && !b.inCreateTx && bundles[b.signature] === createBundle);
    if (bundled.length) {
      ev.push({ signal: "same_bundle_as_create", weight: 0.8, summary: `Bought in the same Jito bundle as the creation (${createBundle}).`, refs: bundled.map((b) => b.signature) });
      union(wallet, creator);
    }
    const shared = buys.filter((b) => b.buyersInTx > 1 && !b.inCreateTx);
    if (shared.length) {
      ev.push({ signal: "multi_buyer_tx", weight: 0.7, summary: `Bought in a transaction signed by ${shared[0]!.buyersInTx - 1} other buying wallet(s).`, refs: shared.map((b) => b.signature) });
      for (const b of shared) for (const o of d.buys) if (o.signature === b.signature) union(wallet, o.wallet);
    }
    const f = funding[wallet]?.funder;
    const peers = f && f !== creator ? byFunder.get(f)! : [];
    if (peers.length >= 2) {
      const n = peers.length;
      ev.push({
        signal: "shared_funder",
        weight: round(Math.min(0.9, 1 - 0.75 ** (n - 1))),
        summary: `First SOL came from ${f}, which also first funded ${n - 1} other launch buyer(s).`,
        refs: [f!, ...peers.filter((p) => p !== wallet)],
      });
      for (const p of peers) union(wallet, p);
    }
    if (buys.some((b) => b.slot === create.slot) && wallet !== creator && !buys.some((b) => b.inCreateTx)) {
      // Snipers also buy in the creation slot, so this alone never makes an insider.
      ev.push({ signal: "same_slot_as_create", weight: 0.3, summary: `Bought in the creation slot ${create.slot}.`, refs: sigs });
    }
    const first = funding[wallet]?.firstSeen;
    const firstBuy = buys.length ? Math.min(...buys.map((b) => b.blockTime)) : null;
    if (first !== null && first !== undefined && firstBuy !== null && firstBuy - first < FRESH_SEC && wallet !== creator) {
      ev.push({ signal: "fresh_wallet", weight: 0.2, summary: `First ever transaction ${Math.round((firstBuy - first) / 60)} min before buying.`, refs: [] });
    }
    ev.sort((a, b) => b.weight - a.weight || a.signal.localeCompare(b.signal));
    const score = round(1 - ev.reduce((p, e) => p * (1 - e.weight), 1));
    results.push({
      wallet,
      score,
      insider: score >= insiderThreshold,
      tokensBought: buys.reduce((s, b) => s + b.tokens, 0),
      solSpent: round(buys.reduce((s, b) => s + b.solSpent, 0), 9),
      holding: d.holdings?.[wallet] ?? null,
      group: null,
      evidence: ev,
      notes: funding[wallet]?.busy ? ["Over 1000 transactions, so its first funding was not traced. Often a trading bot."] : [],
    });
  }

  // Number groups of two or more insiders.
  const insiders = results.filter((r) => r.insider);
  const roots = new Map<string, string[]>();
  for (const r of insiders) roots.set(find(r.wallet), [...(roots.get(find(r.wallet)) ?? []), r.wallet]);
  const groups = [...roots.values()].filter((g) => g.length >= 2).map((g) => g.sort()).sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1)).map((wallets, i) => ({ id: i + 1, wallets }));
  for (const g of groups) for (const w of g.wallets) results.find((r) => r.wallet === w)!.group = g.id;

  results.sort((a, b) => b.score - a.score || b.tokensBought - a.tokensBought || (a.wallet < b.wallet ? -1 : 1));
  const insiderBought = insiders.reduce((s, r) => s + r.tokensBought, 0);
  const held = insiders.map((r) => r.holding);
  const insiderBoughtShare = round(insiderBought / d.supply);
  const bought = results.filter((r) => r.tokensBought > 0).map((r) => r.tokensBought);
  return {
    mint: d.mint,
    creator,
    createSignature: create.signature,
    createSlot: create.slot,
    creatorFunder: funding[creator]?.funder ?? null,
    creatorAgeSec: funding[creator]?.firstSeen != null ? create.blockTime - funding[creator]!.firstSeen! : null,
    supply: d.supply,
    launchBuyers: bought.length,
    launchTokens: bought.reduce((a, b) => a + b, 0),
    insiders: insiders.length,
    insiderBoughtShare,
    insiderHeldShare: held.every((h) => h !== null) ? round(held.reduce((s, h) => s + h!, 0) / d.supply) : null,
    verdict: insiderBoughtShare >= 0.2 ? "high" : insiderBoughtShare >= 0.05 ? "medium" : "low",
    concentration: { hhi: bought.length ? round(hhi(bought)) : 0, gini: bought.length > 1 ? round(gini(bought)) : 0 },
    groups,
    wallets: results,
  };
}
