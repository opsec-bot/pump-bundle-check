import { SOL_MINT, type ParsedIx, type ParsedTx } from "./swaps.js";

/** Jito tip accounts, from the block engine's getTipAccounts (checked 2026-10-08). */
export const JITO_TIP_ACCOUNTS = new Set([
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
]);

const SYSTEM = "11111111111111111111111111111111";

function allInstructions(tx: ParsedTx): ParsedIx[] {
  return [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions)];
}

/** Lamports sent to Jito tip accounts anywhere in the transaction. */
export function tipLamports(tx: ParsedTx): number {
  let sum = 0;
  for (const ix of allInstructions(tx)) {
    if (ix.programId !== SYSTEM || typeof ix.parsed !== "object" || ix.parsed.type !== "transfer") continue;
    const info = ix.parsed.info!;
    if (JITO_TIP_ACCOUNTS.has(String(info.destination))) sum += Number(info.lamports);
  }
  return sum;
}

/**
 * The owner's net balance change over the whole transaction, per mint, in whole tokens. Native SOL and wrapped SOL
 * are merged under the wrapped SOL mint. The transaction fee and Jito tips are added back so they do not look like
 * trading; they are counted as costs elsewhere.
 */
export function ownerDeltas(tx: ParsedTx, owner: string): Map<string, number> {
  const out = new Map<string, number>();
  const add = (mint: string, x: number) => out.set(mint, (out.get(mint) ?? 0) + x);
  const meta = tx.meta;
  if (!meta) return out;

  const raw = new Map<number, { mint: string; decimals: number; pre: bigint; post: bigint }>();
  for (const [list, key] of [[meta.preTokenBalances, "pre"], [meta.postTokenBalances, "post"]] as const) {
    for (const b of list ?? []) {
      if (b.owner !== owner) continue;
      const r = raw.get(b.accountIndex) ?? { mint: b.mint, decimals: b.uiTokenAmount.decimals, pre: 0n, post: 0n };
      r[key] = BigInt(b.uiTokenAmount.amount);
      raw.set(b.accountIndex, r);
    }
  }
  for (const r of raw.values()) if (r.post !== r.pre) add(r.mint, Number(r.post - r.pre) / 10 ** r.decimals);

  const keys = tx.transaction.message.accountKeys;
  const i = keys.findIndex((k) => k.pubkey === owner);
  if (i >= 0 && meta.preBalances && meta.postBalances) {
    let lamports = meta.postBalances[i]! - meta.preBalances[i]!;
    if (i === 0) lamports += meta.fee ?? 0;
    lamports += tipLamports(tx);
    if (lamports !== 0) add(SOL_MINT, lamports / 1e9);
  }
  return out;
}

export type Flow = "directional" | "cycle" | "other";

/**
 * How the trader's whole transaction looks around one base/quote fill:
 * directional = base and quote moved in opposite directions and nothing else moved;
 * cycle = the fill was undone elsewhere in the same transaction, so neither side moved by half the fill or more
 * (an atomic loop that ends where it started; its profit is small next to the fill);
 * other = anything else.
 */
export function flowOf(
  deltas: Map<string, number>,
  fill: { side: "buy" | "sell"; base: number; quote: number },
  baseMint: string,
  quoteMint: string,
): Flow {
  for (const [mint, d] of deltas) if (mint !== baseMint && mint !== quoteMint && d !== 0) return "other";
  const dBase = deltas.get(baseMint) ?? 0;
  const dQuote = deltas.get(quoteMint) ?? 0;
  const baseMoved = Math.abs(dBase) >= 0.5 * fill.base;
  const quoteMoved = Math.abs(dQuote) >= 0.5 * fill.quote;
  const want = fill.side === "buy" ? 1 : -1;
  if (baseMoved && quoteMoved && Math.sign(dBase) === want && Math.sign(dQuote) === -want) return "directional";
  if (!baseMoved && !quoteMoved) return "cycle";
  return "other";
}
