import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, type LaunchData } from "../src/analyze.js";
import { toText } from "../src/cli.js";

describe("cli", () => {
  it("prints a readable report for the real launch", () => {
    const data = JSON.parse(readFileSync("test/fixtures/launch-8U8o.json", "utf8")) as LaunchData;
    const text = toText(analyze(data));
    expect(text).toContain("Creator wallet: 25 s old at creation");
    expect(text).toContain("Insiders: 1, bought 5.00% of supply, hold 0.00% now");
    expect(text).toContain("Verdict: MEDIUM");
  });

  it("prints usage on bad input", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("bundle check <mint>");
  }, 30_000);
});
