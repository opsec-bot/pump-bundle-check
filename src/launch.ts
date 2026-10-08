import { ownerDeltas } from "./features.js";
import { SOL_MINT, type ParsedTx } from "./swaps.js";

export interface Buy {
  wallet: string;
  signature: string;
  slot: number;
  txIndex: number;
  blockTime: number;
  /** Tokens of the mint received, whole units. */
  tokens: number;
  /** SOL the wallet spent in the transaction, fees and tips excluded. */
  solSpent: number;
  inCreateTx: boolean;
  /** How many signers bought the mint in this transaction. */
  buyersInTx: number;
}

/** True if this transaction is where the mint's first token balances appear. */
export function isCreation(tx: ParsedTx, mint: string): boolean {
  const pre = (tx.meta?.preTokenBalances ?? []).some((b) => b.mint === mint);
  const post = (tx.meta?.postTokenBalances ?? []).some((b) => b.mint === mint);
  return !tx.meta?.err && !pre && post;
}

/** The first signer of the creation transaction. */
export function creatorOf(tx: ParsedTx): string {
  return tx.transaction.message.accountKeys.find((k) => k.signer)!.pubkey;
}

/** Every signer whose balance of `mint` went up in this transaction. */
export function buysIn(tx: ParsedTx, mint: string, txIndex: number, createSignature: string): Buy[] {
  if (!tx.meta || tx.meta.err) return [];
  const signers = tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey);
  const raw: Omit<Buy, "buyersInTx">[] = [];
  for (const wallet of signers) {
    const d = ownerDeltas(tx, wallet);
    const tokens = d.get(mint) ?? 0;
    if (tokens <= 0) continue;
    raw.push({
      wallet,
      signature: tx.transaction.signatures[0]!,
      slot: tx.slot,
      txIndex,
      blockTime: tx.blockTime ?? 0,
      tokens,
      solSpent: Math.max(0, -(d.get(SOL_MINT) ?? 0)),
      inCreateTx: tx.transaction.signatures[0] === createSignature,
    });
  }
  return raw.map((b) => ({ ...b, buyersInTx: raw.length }));
}
