# Research notes

Read October 2026.

## The problem
On Pump.fun, a creator can buy a large part of a new token's supply in the creation transaction, or bundle the
creation with buys from many wallets so it looks like organic demand, then sell into the buyers who follow.

- Open-source bundlers are common on GitHub: tools advertising launches with 20 to 21 wallets in the same block, and a
  "solana-rugpull-bot" that offers "anti-bubble mapping"
  ([listing](https://awesome.ecosyste.ms/projects/github.com%2Fbitman09%2Fsolana-rugpull-bot)). One topic page lists a tool
  that claims to avoid the "bundler" mark in Axiom, Photon and GMGN ([GitHub topic](https://github.com/topics/bubblemaps)).
- The checks traders use today are closed: Trench Bot style scanners, Bubblemaps, terminal badges. A Datawallet guide
  ([French](https://www.datawallet.com/fr/crypto/solana-bundles-explained-and-checking-risks)) describes the core check as
  whether the first liquidity and the early large buys share a Jito bundle id.
- We found no maintained open-source detector.

## What we built on
- solana-sybil-score's funding signals: the first SOL a wallet receives is the best cheap link between wallets that
  look unrelated.
- Jito's public bundle lookup, `https://bundles.jito.wtf/api/v1/bundles/transaction/<signature>`, which returns the
  bundle id for a transaction that landed in one. Checked 2026-10-08.
- Mainnet now has version 1 transactions, so every request allows `maxSupportedTransactionVersion: 1`.

## A real case
Token `8U8oQC8dh3c1UxjBr2Yc1Q8tBrueKwBpnqqVobVFpump`, created 2026-10-08 in slot 454659663. The creation transaction
(CreateV2 plus BuyV2) gave the creator `JCGj...` 50,000,000 tokens, 5% of supply, and landed in a Jito bundle. Four
buyers put in 4.1 SOL in the same slot. The creator sold everything one slot later for a 0.37 SOL profit. solana-sandwich-scan
first flagged it as a sandwich; this tool shows what it is. It is the test fixture.
