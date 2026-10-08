import type { Funding, LaunchData } from "./analyze.js";
import { buysIn, creatorOf, isCreation } from "./launch.js";
import { pool, sleep, type Rpc, type SignatureInfo } from "./rpc.js";
import type { ParsedIx, ParsedTx } from "./swaps.js";

export const JITO_BUNDLES_API = "https://bundles.jito.wtf/api/v1/bundles/transaction";
const SYSTEM = "11111111111111111111111111111111";

type IndexedTx = ParsedTx & { transactionIndex?: number };

/** Oldest-first signatures of the mint, back to its creation. Throws if the history is longer than maxSignatures. */
export async function mintHistory(rpc: Rpc, mint: string, maxSignatures = 3000): Promise<SignatureInfo[]> {
  const all: SignatureInfo[] = [];
  let before: string | undefined;
  while (all.length < maxSignatures) {
    const page = await rpc.getSignaturesForAddress(mint, { limit: 1000, ...(before ? { before } : {}) });
    all.push(...page);
    if (page.length < 1000) return all.reverse();
    before = page.at(-1)!.signature;
  }
  throw new Error(`${mint} has more than ${maxSignatures} transactions; raise --max-signatures to reach its creation`);
}

/** Jito bundle id for a transaction, or null if it did not land in a bundle. */
export async function jitoBundle(signature: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(`${JITO_BUNDLES_API}/${signature}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`jito bundles: HTTP ${res.status}`);
  const body = (await res.json()) as { bundle_id?: string }[];
  return body[0]?.bundle_id ?? null;
}

/** Sender of the first SOL a wallet received, and when it first appeared. Unknown for wallets with 1000+ transactions. */
export async function walletFunding(rpc: Rpc, wallet: string): Promise<Funding> {
  const sigs = await rpc.getSignaturesForAddress(wallet, { limit: 1000 });
  if (sigs.length === 0) return { funder: null, firstSeen: null };
  if (sigs.length >= 1000) return { funder: null, firstSeen: null, busy: true };
  const oldest = sigs.at(-1)!;
  const tx = await rpc.getTransaction(oldest.signature);
  return { funder: tx ? firstSolSender(tx, wallet) : null, firstSeen: oldest.blockTime };
}

/** Who sent `wallet` SOL in this transaction, via a system transfer or account creation. */
export function firstSolSender(tx: ParsedTx, wallet: string): string | null {
  const ixs: ParsedIx[] = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions)];
  for (const ix of ixs) {
    if (ix.programId !== SYSTEM || typeof ix.parsed !== "object" || !ix.parsed.info) continue;
    const info = ix.parsed.info;
    const to = info.destination ?? info.newAccount;
    if (to === wallet && info.source !== wallet) return String(info.source);
  }
  return null;
}

export async function tokenSupply(rpc: Rpc, mint: string): Promise<number> {
  const r = await rpc.call<{ value: { uiAmount: number } }>("getTokenSupply", [mint]);
  return r.value.uiAmount;
}

export async function holding(rpc: Rpc, wallet: string, mint: string): Promise<number> {
  const r = await rpc.call<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }[] }>(
    "getTokenAccountsByOwner",
    [wallet, { mint }, { encoding: "jsonParsed" }],
  );
  return r.value.reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

export interface CollectOptions {
  windowSlots?: number;
  maxSignatures?: number;
  jito?: boolean;
  funders?: boolean;
  /** Cap on launch wallets whose funding is looked up. */
  maxFunded?: number;
  concurrency?: number;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
}

/** Everything `analyze` needs, from public RPC and the Jito bundle lookup. */
export async function collect(rpc: Rpc, mint: string, opts: CollectOptions = {}): Promise<LaunchData> {
  const log = opts.log ?? (() => {});
  const window = opts.windowSlots ?? 10;
  const sigs = await mintHistory(rpc, mint, opts.maxSignatures);
  if (sigs.length === 0) throw new Error(`no transactions for ${mint}`);
  log(`history: ${sigs.length} transactions`);

  const createInfo = sigs.find((s) => !s.err)!;
  const createTx = (await rpc.getTransaction(createInfo.signature)) as IndexedTx | null;
  if (!createTx || !isCreation(createTx, mint)) throw new Error(`could not find the creation transaction of ${mint}`);
  const create = { signature: createInfo.signature, slot: createTx.slot, blockTime: createTx.blockTime ?? 0, creator: creatorOf(createTx) };

  const early = sigs.filter((s) => !s.err && s.slot <= create.slot + window);
  log(`launch window: ${early.length} transactions in ${window + 1} slots`);
  const txs = await pool(early, opts.concurrency ?? 2, async (s) =>
    s.signature === create.signature ? createTx : ((await rpc.getTransaction(s.signature)) as IndexedTx | null),
  );
  const buys = txs.flatMap((tx) => (tx ? buysIn(tx, mint, tx.transactionIndex ?? -1, create.signature) : []));
  log(`launch buys: ${buys.length}`);

  const bundles: Record<string, string | null> = {};
  if (opts.jito !== false) {
    for (const sig of [create.signature, ...new Set(buys.map((b) => b.signature))]) {
      if (sig in bundles) continue;
      bundles[sig] = await jitoBundle(sig, opts.fetch).catch(() => null);
      await sleep(200);
    }
  }

  const wallets = [create.creator, ...new Set(buys.map((b) => b.wallet))].filter((w, i, a) => a.indexOf(w) === i).slice(0, opts.maxFunded ?? 40);
  const funding: Record<string, Funding> = {};
  if (opts.funders !== false) {
    await pool(wallets, opts.concurrency ?? 2, async (w) => {
      funding[w] = await walletFunding(rpc, w).catch(() => ({ funder: null, firstSeen: null }));
    });
  }

  const holdings: Record<string, number> = {};
  await pool(wallets, opts.concurrency ?? 2, async (w) => {
    holdings[w] = await holding(rpc, w, mint);
  });

  return { mint, supply: await tokenSupply(rpc, mint), create, buys, bundles, funding, holdings };
}
