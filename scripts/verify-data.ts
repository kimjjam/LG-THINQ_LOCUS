import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import {
  classifyGaps,
  type GapDecision,
  type MarketGroup,
  type MarketStat,
  type Thresholds,
} from "../lib/classify";
import { queryDailyReviewCounts } from "../lib/data.server";

type Meta = {
  markets: { code: string; name: string }[];
  groups: Record<string, string[]>;
  topics: { id: number; label: string; exclude_from_gap: boolean }[];
  thresholds: {
    lift: number;
    residual: number;
    group_common: number;
    partial_common: number;
  };
};

type ExpectedGap = {
  market_code: string;
  topic: string;
  lift: string;
  residual: string;
  verdict: GapDecision["verdict"];
  rule_basis: string;
};

const root = process.cwd();
const keyOf = (marketCode: string, topicId: number) => `${marketCode}:${topicId}`;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const finiteNumber = (raw: unknown, label: string) => {
  assert(raw !== null && raw !== undefined && String(raw).trim() !== "", `Missing ${label}`);
  const value = Number(raw);
  assert(Number.isFinite(value), `Invalid ${label}: ${raw}`);
  return value;
};

const meta = JSON.parse(await readFile(resolve(root, "data/meta.json"), "utf8")) as Meta;
const marketCodeByName = new Map(meta.markets.map(({ code, name }) => [name, code]));
const thresholds: Thresholds = {
  lift: meta.thresholds.lift,
  residual: meta.thresholds.residual,
  groupCommon: meta.thresholds.group_common,
  partialCommon: meta.thresholds.partial_common,
};

async function readWideMatrix(fileName: string) {
  const rows = parse(await readFile(resolve(root, "data", fileName), "utf8"), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  const values = new Map<string, number>();

  for (const row of rows) {
    const marketCode = marketCodeByName.get(row.market);
    assert(marketCode, `${fileName}: unknown market ${row.market}`);
    for (const topic of meta.topics) {
      const key = keyOf(marketCode, topic.id);
      assert(!values.has(key), `${fileName}: duplicate ${key}`);
      values.set(key, finiteNumber(row[String(topic.id)], `${fileName}:${key}`));
    }
  }

  const expectedCells = meta.markets.length * meta.topics.length;
  assert(values.size === expectedCells, `${fileName}: expected ${expectedCells} cells, got ${values.size}`);
  return values;
}

const [referenceLift, referenceResidual] = await Promise.all([
  readWideMatrix("lift_no_event.csv"),
  readWideMatrix("resid_no_event.csv"),
]);

const referenceStats: MarketStat[] = [...referenceLift].map(([key, lift]) => {
  const [marketCode, topic] = key.split(":");
  const residual = referenceResidual.get(key);
  assert(residual !== undefined, `Missing residual reference: ${key}`);
  return { marketCode, topicId: Number(topic), lift, residual };
});

const referenceGroups: MarketGroup[] = Object.entries(meta.groups).map(
  ([name, marketNames], index) => ({
    id: index + 1,
    name,
    marketCodes: marketNames.map((marketName) => {
      const code = marketCodeByName.get(marketName);
      assert(code, `Unknown group member: ${marketName}`);
      return code;
    }),
  }),
);

const expectedRows = parse(
  await readFile(resolve(root, "data/expected_gaps.csv"), "utf8"),
  { columns: true, bom: true, skip_empty_lines: true, trim: true },
) as ExpectedGap[];

function compareDecisions(actual: readonly GapDecision[], checkExpectedNumbers: boolean) {
  const errors: string[] = [];
  const actualByKey = new Map(actual.map((row) => [keyOf(row.marketCode, row.topicId), row]));
  const expectedByKey = new Map<string, ExpectedGap>();

  for (const expected of expectedRows) {
    const key = keyOf(expected.market_code, finiteNumber(expected.topic, "expected topic"));
    if (expectedByKey.has(key)) errors.push(`duplicate expected gap ${key}`);
    expectedByKey.set(key, expected);

    const decision = actualByKey.get(key);
    if (!decision) {
      errors.push(`missing gap ${key}`);
      continue;
    }
    if (decision.verdict !== expected.verdict) {
      errors.push(`${key} verdict: expected ${expected.verdict}, got ${decision.verdict}`);
    }
    if (decision.ruleBasis !== expected.rule_basis) {
      errors.push(`${key} rule_basis: expected ${expected.rule_basis}, got ${decision.ruleBasis}`);
    }
    if (checkExpectedNumbers) {
      if (
        decision.lift.toFixed(4) !== finiteNumber(expected.lift, `${key} expected lift`).toFixed(4)
      ) {
        errors.push(`${key} lift does not match expected_gaps.csv`);
      }
      if (
        decision.residual.toFixed(4) !==
        finiteNumber(expected.residual, `${key} expected residual`).toFixed(4)
      ) {
        errors.push(`${key} residual does not match expected_gaps.csv`);
      }
    }
  }

  for (const key of actualByKey.keys()) {
    if (!expectedByKey.has(key)) errors.push(`unexpected gap ${key}`);
  }
  return errors;
}

function throwIfErrors(label: string, errors: string[]) {
  if (errors.length === 0) return;
  const shown = errors.slice(0, 20).join("\n- ");
  throw new Error(`${label} failed (${errors.length}):\n- ${shown}`);
}

const excludedReferenceTopics = new Set(
  meta.topics.filter((topic) => topic.exclude_from_gap).map((topic) => topic.id),
);
const referenceDecisions = classifyGaps({
  stats: referenceStats,
  groups: referenceGroups,
  excludedTopicIds: excludedReferenceTopics,
  thresholds,
});
throwIfErrors("Reference classification", compareDecisions(referenceDecisions, true));
console.log(`Reference OK: ${referenceStats.length} cells, ${referenceDecisions.length} expected gaps.`);

const args = process.argv.slice(2);
assert(args.every((arg) => arg === "--reference-only"), `Unknown argument: ${args.join(" ")}`);
if (args.includes("--reference-only")) process.exit(0);

try {
  loadEnvFile(resolve(root, ".env.local"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert(supabaseUrl, "Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
assert(anonKey, "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [statsResult, marketsResult, groupsResult, topicsResult] = await Promise.all([
  supabase.from("market_stats").select("market_code,topic_id,lift,residual"),
  supabase.from("markets").select("code,name,group_id,analyzed_count"),
  supabase.from("market_groups").select("id,name").order("id"),
  supabase.from("topics").select("id,label,is_positive,is_noise"),
]);

for (const result of [statsResult, marketsResult, groupsResult, topicsResult]) {
  if (result.error) throw result.error;
}

const dbStats = (statsResult.data ?? []).map((row) => ({
  marketCode: String(row.market_code),
  topicId: finiteNumber(row.topic_id, "DB topic_id"),
  lift: finiteNumber(row.lift, "DB lift"),
  residual: finiteNumber(row.residual, "DB residual"),
}));
const dbMarkets = marketsResult.data ?? [];
const dbGroups: MarketGroup[] = (groupsResult.data ?? []).map((group) => ({
  id: finiteNumber(group.id, "DB group id"),
  name: String(group.name),
  marketCodes: dbMarkets
    .filter((market) => Number(market.group_id) === Number(group.id))
    .map((market) => String(market.code)),
}));
const excludedDbTopics = new Set(
  (topicsResult.data ?? [])
    .filter((topic) => Boolean(topic.is_positive) || Boolean(topic.is_noise))
    .map((topic) => finiteNumber(topic.id, "DB topic id")),
);

const dbStatByKey = new Map(dbStats.map((stat) => [keyOf(stat.marketCode, stat.topicId), stat]));
const numericErrors: string[] = [];
for (const [key, expectedLift] of referenceLift) {
  const actual = dbStatByKey.get(key);
  if (!actual) {
    numericErrors.push(`missing market_stats row ${key}`);
    continue;
  }
  if (actual.lift.toFixed(2) !== expectedLift.toFixed(2)) {
    numericErrors.push(`${key} lift: expected ${expectedLift.toFixed(2)}, got ${actual.lift.toFixed(2)}`);
  }
  const expectedResidual = referenceResidual.get(key)!;
  if (actual.residual.toFixed(2) !== expectedResidual.toFixed(2)) {
    numericErrors.push(
      `${key} residual: expected ${expectedResidual.toFixed(2)}, got ${actual.residual.toFixed(2)}`,
    );
  }
}
for (const key of dbStatByKey.keys()) {
  if (!referenceLift.has(key)) numericErrors.push(`unexpected market_stats row ${key}`);
}
throwIfErrors("Database numeric comparison", numericErrors);

const dbDecisions = classifyGaps({
  stats: dbStats,
  groups: dbGroups,
  excludedTopicIds: excludedDbTopics,
  thresholds,
});
throwIfErrors("Database gap comparison", compareDecisions(dbDecisions, false));

const distribution = [...new Set(dbDecisions.map((row) => row.verdict))]
  .map(
    (verdict) =>
      `${verdict} ${dbDecisions.filter((row) => row.verdict === verdict).length}`,
  )
  .join(" / ");
console.log(`Database OK: ${dbStats.length} cells; ${distribution}.`);

const dailyTotals = new Map<string, number>();
for (const day of await queryDailyReviewCounts()) {
  dailyTotals.set(day.marketCode, (dailyTotals.get(day.marketCode) ?? 0) + day.stars.reduce((sum, count) => sum + count, 0));
}
for (const market of dbMarkets) {
  assert(dailyTotals.get(market.code) === market.analyzed_count, `Daily review count mismatch: ${market.code}`);
}
console.log(`Daily review counts OK: ${[...dailyTotals.values()].reduce((sum, count) => sum + count, 0)} reviews.`);
