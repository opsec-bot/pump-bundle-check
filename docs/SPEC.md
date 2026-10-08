# Spec: pump-bundle-check v1

## Goal
Given a Pump.fun token, show who bought at launch as a group (the creator, wallets in the same bundle or transaction,
wallets funded by the creator or by one shared source), how much of the supply they took, and how much they still hold.
Every flag comes with the signatures behind it.

Open-source bundlers are easy to find; there are even tools sold to hide bundles from Bubblemaps and trading
terminals. We found no maintained open-source detector.

## Inputs, all from public data
1. **The creation transaction**: page back through `getSignaturesForAddress(mint)` to the oldest signature (up to
   `maxSignatures`, default 3000). It must be the transaction where the mint's first token balances appear. The
   creator is its first signer.
2. **Launch window**: every successful transaction on the mint within `windowSlots` (default 10) slots of creation.
3. **Buys**: in each launch transaction, every signer whose balance of the mint went up. Read from token balance
   changes, so it works for the bonding curve, PumpSwap and any router. SOL spent is the signer's lamport change with
   fee and Jito tips added back.
4. **Jito bundle ids** for the creation transaction and each launch buy, from the public `bundles.jito.wtf` lookup.
   Optional.
5. **Funders**: for the creator and each launch buyer, the sender of the first SOL the wallet ever received, and the time
   of its first transaction. Uses the wallet's oldest signature, so wallets with more than 1000 transactions are
   skipped.
6. **Supply and holdings**: `getTokenSupply`, and each flagged wallet's current balance of the mint.

## Signals
Each signal is evidence with a weight. A wallet's score is `1 - product(1 - w)` (noisy-OR), as in solana-sybil-score.

| Signal | When | Weight |
|---|---|---|
| `creator` | first signer of the creation transaction | 1 |
| `in_create_tx` | bought inside the creation transaction | 0.9 |
| `funded_by_creator` | first SOL came from the creator | 0.9 |
| `same_bundle_as_create` | Jito bundle id equals the creation transaction's | 0.8 |
| `multi_buyer_tx` | shared a transaction with other buying signers | 0.7 |
| `shared_funder` | first SOL came from the same address as `n - 1` other launch buyers | `1 - 0.75^(n-1)`, max 0.9 |
| `same_slot_as_create` | bought in the creation slot (snipers do too, so never enough alone) | 0.3 |
| `fresh_wallet` | first transaction under an hour before the buy | 0.2 |

A wallet with a score of 0.5 or more is an **insider**. Insiders linked by shared transactions, bundles or funders are
grouped with union-find.

## Output
- Per wallet: score, signals with signatures, tokens bought, SOL spent, current holding.
- The creator's first funder and the age of the creator's wallet at creation.
- Wallets with 1000+ transactions are marked: their funding is not traced, and they are often bots.
- Totals: insider share of supply bought at launch, insider share held now, total launch buys.
- Verdict on the launch share: under 5% `low`, under 20% `medium`, 20% or more `high`.
- Holder concentration among the launch buyers: HHI and Gini of tokens bought.

## CLI
```
bundle check <mint> [--rpc url] [--window 10] [--no-jito] [--no-funders] [--json]
```

## Limits
- A token older than `maxSignatures` transactions cannot be traced back to its creation.
- Buyers who sign nothing (a router buys on their behalf) are not seen.
- Insiders who fund through an exchange withdrawal and buy a few slots later from fresh wallets only show up through
  `fresh_wallet` and timing.
