# pump-bundle-check

An open bundle and insider check for Pump.fun launches.

Give it a token. It goes back to the creation transaction, reads every buy in the first slots, and flags the wallets
that bought as a group with the creator: same transaction, same Jito bundle, funded by the creator, or funded by one
shared address. Then it tells you how much of the supply they took and how much they still hold. Every flag lists the
signatures behind it.

Bundler tools are open source and some are sold to hide bundles from Bubblemaps and trading terminals. The checks
traders rely on are closed. We found no maintained open-source one.

## Example
```
$ npx tsx src/cli.ts check 8U8oQC8dh3c1UxjBr2Yc1Q8tBrueKwBpnqqVobVFpump
Token 8U8oQC8dh3c1UxjBr2Yc1Q8tBrueKwBpnqqVobVFpump
Created in slot 454659663 by JCGjLMrCbFHExLUSiFvEVhdsKnth7YZowkHvpiCYWTuw
Creator wallet: 25 s old at creation, first funded by 99op4B7ftEikAdPpeHHsDfHivJm3r5tuoc3D9QnaSUgg

Launch buyers: 5, tokens bought: 166,778,801.63 (16.68% of supply)
Insiders: 1, bought 5.00% of supply, hold 0.00% now
Verdict: MEDIUM
```

The creator bought 5% inside the creation transaction, four sniper bots bought in the same slot, and the creator sold
everything one slot later. Full output for this and another launch is in
[docs/sample-2026-10-08.md](docs/sample-2026-10-08.md).

## Signals
| Signal | Weight |
|---|---|
| Created the token | 1 |
| Bought inside the creation transaction | 0.9 |
| First SOL came from the creator | 0.9 |
| Same Jito bundle as the creation | 0.8 |
| Shared a transaction with other buying wallets | 0.7 |
| First SOL came from the same address as other launch buyers | up to 0.9 |
| Bought in the creation slot (snipers do too, so never enough alone) | 0.3 |
| Wallet first appeared under an hour before buying | 0.2 |

Score = `1 - product(1 - weight)`. At 0.5 or more a wallet is an insider. Verdict on the share of supply insiders
bought at launch: under 5% low, under 20% medium, 20% or more high. Wallets with 1000+ transactions are noted as likely
bots, since their first funding is too far back to trace cheaply.

Details in [docs/SPEC.md](docs/SPEC.md), background in [docs/RESEARCH.md](docs/RESEARCH.md).

## Try it
Needs Node 22 or newer.

```sh
npm install
npm test
npx tsx src/cli.ts check <mint>
```

Options: `--rpc <url>`, `--window <slots>` (default 10), `--max-signatures <n>` (default 3000), `--no-jito`,
`--no-funders`, `--json`. The public RPC works for a single check; it takes a minute because it is rate limited.

## Limits
- Tokens with more than `--max-signatures` transactions cannot be traced back to creation.
- Buys made by a router on someone's behalf, where the buyer signs nothing, are not seen.
- Insiders who fund each wallet from a separate exchange withdrawal and wait a few slots mostly show up only as fresh
  wallets.

## License
MIT
