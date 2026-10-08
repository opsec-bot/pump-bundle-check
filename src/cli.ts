#!/usr/bin/env -S npx tsx
import { analyze, type Report } from "./analyze.js";
import { collect } from "./fetch.js";
import { Rpc } from "./rpc.js";

const USAGE = `Usage:
  bundle check <mint> [--rpc url] [--window 10] [--max-signatures 3000] [--no-jito] [--no-funders] [--json]`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function bool(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const num = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function toText(r: Report): string {
  const lines = [
    `Token ${r.mint}`,
    `Created in slot ${r.createSlot} by ${r.creator}`,
    `Creator wallet: ${r.creatorAgeSec === null ? "age unknown" : `${num(r.creatorAgeSec)} s old at creation`}, first funded by ${r.creatorFunder ?? "unknown"}`,
    "",
    `Launch buyers: ${r.launchBuyers}, tokens bought: ${num(r.launchTokens)} (${pct(r.launchTokens / r.supply)} of supply)`,
    `Insiders: ${r.insiders}, bought ${pct(r.insiderBoughtShare)} of supply, hold ${r.insiderHeldShare === null ? "unknown" : pct(r.insiderHeldShare)} now`,
    `Verdict: ${r.verdict.toUpperCase()}`,
    `Launch buy concentration: HHI ${r.concentration.hhi}, Gini ${r.concentration.gini}`,
    "",
  ];
  for (const w of r.wallets) {
    const tag = w.insider ? "INSIDER" : "buyer";
    lines.push(`${tag} ${w.wallet}  score ${w.score}  bought ${num(w.tokensBought)} for ${num(w.solSpent)} SOL  holds ${w.holding === null ? "?" : num(w.holding)}${w.group ? `  group ${w.group}` : ""}`);
    for (const e of w.evidence) lines.push(`  [${e.signal}, ${e.weight}] ${e.summary}${e.refs.length ? `  ${e.refs.slice(0, 3).join(", ")}` : ""}`);
    for (const n of w.notes) lines.push(`  note: ${n}`);
  }
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd !== "check") return usage();
  const rpc = new Rpc(flag(args, "--rpc") ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com");
  const windowSlots = Number(flag(args, "--window") ?? 10);
  const maxSignatures = Number(flag(args, "--max-signatures") ?? 3000);
  const jito = !bool(args, "--no-jito");
  const funders = !bool(args, "--no-funders");
  const json = bool(args, "--json");
  if (!args[0]) return usage();
  const data = await collect(rpc, args[0], { windowSlots, maxSignatures, jito, funders, concurrency: 1, log: (m) => process.stderr.write(m + "\n") });
  const report = analyze(data);
  process.stdout.write((json ? JSON.stringify(report, null, 2) : toText(report)) + "\n");
  return 0;
}

function usage(): number {
  process.stderr.write(USAGE + "\n");
  return 1;
}

if (process.argv[1]?.endsWith("cli.ts")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
