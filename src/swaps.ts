/**
 * Pulls swaps out of jsonParsed Solana transactions without any program IDL.
 *
 * A swap is read from the token transfers a pool program makes one level below its own instruction (its CPIs):
 * what the trader paid in, and what the trader got back. This works the same for open AMMs and closed prop AMMs.
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export interface ParsedIx {
  programId: string;
  program?: string;
  parsed?: { type?: string; info?: Record<string, unknown> } | string;
  stackHeight?: number | null;
  accounts?: string[];
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

/** The parts of a jsonParsed transaction this module reads. Works for legacy, v0 and v1 transactions. */
export interface ParsedTx {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    innerInstructions?: { index: number; instructions: ParsedIx[] }[] | null;
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
  } | null;
  transaction: {
    signatures: string[];
    message: { accountKeys: { pubkey: string; signer: boolean }[]; instructions: ParsedIx[] };
  };
}

export interface Swap {
  signature: string;
  slot: number;
  blockTime: number;
  /** Position of the transaction in its block, or -1 if unknown. */
  txIndex: number;
  /** "outer.inner" position of the pool instruction, unique within the transaction. */
  ixPath: string;
  program: string;
  /** Who paid into the pool: the transfer authority on the trader side. */
  trader: string;
  /** The transaction's fee payer. */
  feePayer: string;
  /** The pool's main in and out accounts, sorted. Same program and vaults means same pool. */
  poolVaults: string[];
  mintIn: string;
  amountIn: number;
  mintOut: string;
  amountOut: number;
}

interface Leg {
  mint: string | null;
  amount: bigint;
  decimals: number | null;
  source: string;
  destination: string;
  authority: string;
  dstOwner: string | null;
}

/**
 * All swaps in a transaction made by any of `programs`. Pool instructions with fewer than two transfers (quote
 * updates, deposits, withdrawals) are skipped, as are failed transactions.
 */
export function extractSwaps(tx: ParsedTx, programs: Set<string> | ReadonlySet<string>, txIndex = -1): Swap[] {
  if (!tx.meta || tx.meta.err) return [];
  const msg = tx.transaction.message;
  const keys = msg.accountKeys.map((k) => k.pubkey);
  const signers = new Set(msg.accountKeys.filter((k) => k.signer).map((k) => k.pubkey));
  const feePayer = keys[0]!;

  // Account -> mint/owner, from balances and from accounts initialized inside the transaction.
  const mintOf = new Map<string, string>();
  const ownerOf = new Map<string, string>();
  const decimalsOf = new Map<string, number>([[SOL_MINT, 9]]);
  for (const b of [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])]) {
    const acct = keys[b.accountIndex];
    if (!acct) continue;
    mintOf.set(acct, b.mint);
    if (b.owner) ownerOf.set(acct, b.owner);
    decimalsOf.set(b.mint, b.uiTokenAmount.decimals);
  }

  const swaps: Swap[] = [];
  msg.instructions.forEach((outer, i) => {
    const inner = (tx.meta!.innerInstructions ?? []).find((g) => g.index === i)?.instructions ?? [];
    const flat: ParsedIx[] = [{ ...outer, stackHeight: outer.stackHeight ?? 1 }, ...inner];
    for (const f of flat) noteInit(f, mintOf, ownerOf);

    flat.forEach((ix, k) => {
      if (!programs.has(ix.programId)) return;
      const h = ix.stackHeight ?? 1;
      const legs: Leg[] = [];
      for (let j = k + 1; j < flat.length && (flat[j]!.stackHeight ?? 1) > h; j++) {
        const g = flat[j]!;
        if ((g.stackHeight ?? 1) !== h + 1) continue;
        const leg = toLeg(g, mintOf, ownerOf);
        if (leg) legs.push(leg);
      }
      const swap = legsToSwap(legs, signers, decimalsOf);
      if (!swap) return;
      swaps.push({
        signature: tx.transaction.signatures[0]!,
        slot: tx.slot,
        blockTime: tx.blockTime ?? 0,
        txIndex,
        ixPath: `${i}.${k}`,
        program: ix.programId,
        feePayer,
        ...swap,
      });
    });
  });
  return swaps;
}

function noteInit(ix: ParsedIx, mintOf: Map<string, string>, ownerOf: Map<string, string>) {
  if (typeof ix.parsed !== "object" || !ix.parsed.info) return;
  const info = ix.parsed.info;
  const type = ix.parsed.type ?? "";
  if (type.startsWith("initializeAccount") && typeof info.account === "string" && typeof info.mint === "string") {
    mintOf.set(info.account, info.mint);
    if (typeof info.owner === "string") ownerOf.set(info.account, info.owner);
  }
  if (ix.programId === ATA_PROGRAM && typeof info.account === "string" && typeof info.mint === "string") {
    mintOf.set(info.account, info.mint);
    if (typeof info.wallet === "string") ownerOf.set(info.account, info.wallet);
  }
}

function toLeg(ix: ParsedIx, mintOf: Map<string, string>, ownerOf: Map<string, string>): Leg | null {
  if (typeof ix.parsed !== "object" || !ix.parsed.info) return null;
  const info = ix.parsed.info;
  const type = ix.parsed.type;
  if (ix.programId === SYSTEM_PROGRAM && type === "transfer") {
    const source = String(info.source);
    const destination = String(info.destination);
    return { mint: SOL_MINT, amount: BigInt(String(info.lamports)), decimals: 9, source, destination, authority: source, dstOwner: destination };
  }
  if (!ix.program?.startsWith("spl-token") || (type !== "transfer" && type !== "transferChecked")) return null;
  const source = String(info.source);
  const destination = String(info.destination);
  const authority = String(info.authority ?? info.multisigAuthority ?? "");
  const tokenAmount = info.tokenAmount as { amount: string; decimals: number } | undefined;
  const amount = BigInt(tokenAmount?.amount ?? String(info.amount));
  const mint = (info.mint as string | undefined) ?? mintOf.get(source) ?? mintOf.get(destination) ?? null;
  return { mint, amount, decimals: tokenAmount?.decimals ?? null, source, destination, authority, dstOwner: ownerOf.get(destination) ?? null };
}

function legsToSwap(legs: Leg[], signers: Set<string>, decimalsOf: Map<string, number>) {
  if (legs.length < 2 || legs.some((l) => l.mint === null)) return null;
  // The trader is the authority that signed the transaction. Through a router nobody on the trader side signs,
  // so fall back to the first transfer's authority: pools take payment before they pay out.
  const authorities = [...new Set(legs.map((l) => l.authority))];
  const signed = authorities.filter((a) => signers.has(a));
  const trader = signed.length === 1 ? signed[0]! : legs[0]!.authority;

  // Net flow per mint from the trader's view: positive = paid in, negative = received.
  const traderAccounts = new Set(legs.filter((l) => l.authority === trader).map((l) => l.source));
  const net = new Map<string, bigint>();
  let mainIn: Leg | null = null;
  let mainOut: Leg | null = null;
  for (const l of legs) {
    if (l.authority === trader) {
      net.set(l.mint!, (net.get(l.mint!) ?? 0n) + l.amount);
      if (!mainIn || l.amount > mainIn.amount) mainIn = l;
    } else if (l.dstOwner === trader || traderAccounts.has(l.destination) || l.dstOwner === null) {
      net.set(l.mint!, (net.get(l.mint!) ?? 0n) - l.amount);
      if (!mainOut || l.amount > mainOut.amount) mainOut = l;
    }
    // Anything else is the pool paying a third party (protocol or creator fees).
  }
  const paid = [...net].filter(([, v]) => v > 0n);
  const got = [...net].filter(([, v]) => v < 0n);
  if (paid.length !== 1 || got.length !== 1 || !mainIn || !mainOut) return null;
  const [mintIn, rawIn] = paid[0]!;
  const [mintOut, rawOut] = got[0]!;
  const dec = (m: string) => legs.find((l) => l.mint === m && l.decimals !== null)?.decimals ?? decimalsOf.get(m);
  const decIn = dec(mintIn);
  const decOut = dec(mintOut);
  if (decIn === undefined || decOut === undefined) return null;
  return {
    trader,
    // The account that took the biggest payment and the one that sent the biggest payout. Fee accounts that
    // rotate between transactions are left out, so the pair identifies the pool.
    poolVaults: [mainIn.destination, mainOut.source].sort(),
    mintIn,
    amountIn: Number(rawIn) / 10 ** decIn,
    mintOut,
    amountOut: Number(-rawOut) / 10 ** decOut,
  };
}

export interface Oriented {
  /** "buy" means the trader bought the base token. */
  side: "buy" | "sell";
  base: number;
  quote: number;
  /** Quote per base. */
  price: number;
}

/** A swap seen as a trade of `baseMint` against `quoteMint`, or null if it is a different pair. */
export function orient(s: Swap, baseMint: string, quoteMint: string): Oriented | null {
  if (s.mintIn === quoteMint && s.mintOut === baseMint) {
    return { side: "buy", base: s.amountOut, quote: s.amountIn, price: s.amountIn / s.amountOut };
  }
  if (s.mintIn === baseMint && s.mintOut === quoteMint) {
    return { side: "sell", base: s.amountIn, quote: s.amountOut, price: s.amountOut / s.amountIn };
  }
  return null;
}
