import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";

type TopicMeta = {
  id: number;
  label: string;
  overall_share: number;
  exclude_from_gap: boolean;
};

type MarketMeta = {
  code: string;
  name: string;
  group: string;
  collected_count: number;
  analyzed_count: number;
  complaint_rate: number;
  low_sample: boolean;
};

type Meta = {
  timestamp: { tz: string };
  event_window: { from: string; to: string };
  groups: Record<string, string[]>;
  markets: MarketMeta[];
  topics: TopicMeta[];
};

const root = process.cwd();
const args = process.argv.slice(2);

try {
  loadEnvFile(resolve(root, ".env.local"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const requiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(args.every((arg) => arg === "--dry-run"), `Unknown argument: ${args.join(" ")}`);

const meta = JSON.parse(await readFile(resolve(root, "data/meta.json"), "utf8")) as Meta;
assert(meta.timestamp.tz.toLowerCase().includes("naive"), "Expected naive source timestamps");
assert(
  meta.event_window.from === "2026-07-01" && meta.event_window.to === "2026-08-01",
  "Unexpected event window",
);

const centroidRows = parse(
  await readFile(resolve(root, "data/topic_centroids.csv"), "utf8"),
  { columns: true, bom: true, skip_empty_lines: true, trim: true },
) as Record<string, string>[];
const dimensions = Array.from({ length: 384 }, (_, index) => String(index));
assert(centroidRows.length === meta.topics.length, "Centroid/topic count mismatch");

const centroids = centroidRows.map((row) => {
  const topicId = Number(row.topic_id);
  const vector = dimensions.map((dimension) => Number(row[dimension]));
  assert(Number.isInteger(topicId), `Invalid centroid topic_id: ${row.topic_id}`);
  assert(vector.every(Number.isFinite), `Invalid centroid vector: topic ${topicId}`);
  assert(meta.topics.some((topic) => topic.id === topicId), `Unknown centroid topic: ${topicId}`);
  return { topic_id: topicId, vector: JSON.stringify(vector) };
});

for (const [groupName, memberNames] of Object.entries(meta.groups)) {
  const seededNames = meta.markets
    .filter((market) => market.group === groupName)
    .map((market) => market.name)
    .sort();
  assert(
    JSON.stringify(seededNames) === JSON.stringify([...memberNames].sort()),
    `Group membership mismatch: ${groupName}`,
  );
}

const positiveTopicId = meta.topics.find((topic) => topic.label === "긍정 리뷰")?.id;
const noiseTopicId = meta.topics.find((topic) => topic.label === "기타 기능 요청")?.id;
assert(positiveTopicId !== undefined && noiseTopicId !== undefined, "Missing excluded topic metadata");
for (const topic of meta.topics) {
  assert(
    topic.exclude_from_gap === (topic.id === positiveTopicId || topic.id === noiseTopicId),
    `Unexpected gap exclusion: topic ${topic.id}`,
  );
}

const collectedCount = meta.markets.reduce((sum, market) => sum + market.collected_count, 0);
if (args.includes("--dry-run")) {
  console.log(
    `Seed input OK: ${Object.keys(meta.groups).length} groups, ${meta.markets.length} markets (${collectedCount.toLocaleString()} collected), ${meta.topics.length} topics, and ${centroids.length} centroids.`,
  );
  process.exit(0);
}

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const groupRows = Object.keys(meta.groups).map((name) => ({ name }));
const { data: savedGroups, error: groupError } = await supabase
  .from("market_groups")
  .upsert(groupRows, { onConflict: "name" })
  .select("id,name");
if (groupError) throw groupError;
assert(savedGroups, "Market group upsert returned no rows");

const groupIdByName = new Map(savedGroups.map(({ id, name }) => [name, id]));
assert(groupIdByName.size === groupRows.length, "Not all market groups were returned");

const { error: marketError } = await supabase.from("markets").upsert(
  meta.markets.map((market) => {
    const groupId = groupIdByName.get(market.group);
    assert(groupId !== undefined, `Unknown market group: ${market.group}`);
    return {
      code: market.code,
      name: market.name,
      group_id: groupId,
      analyzed_count: market.analyzed_count,
      collected_count: market.collected_count,
      complaint_rate: market.complaint_rate,
      low_sample: market.low_sample,
      is_active: true,
    };
  }),
  { onConflict: "code" },
);
if (marketError) throw marketError;

const { error: topicError } = await supabase.from("topics").upsert(
  meta.topics.map((topic) => ({
    id: topic.id,
    label: topic.label,
    overall_share: topic.overall_share,
    is_positive: topic.id === positiveTopicId,
    is_noise: topic.id === noiseTopicId,
  })),
  { onConflict: "id" },
);
if (topicError) throw topicError;

const { error: centroidError } = await supabase
  .from("topic_centroids")
  .upsert(centroids, { onConflict: "topic_id" });
if (centroidError) throw centroidError;

console.log(
  `Seeded ${groupRows.length} groups, ${meta.markets.length} markets (${collectedCount.toLocaleString()} collected), ${meta.topics.length} topics, and ${centroids.length} centroids.`,
);
