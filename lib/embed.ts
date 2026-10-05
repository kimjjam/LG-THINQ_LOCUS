import "client-only";

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

type Embedder = (
  text: string,
  options: { pooling: "mean"; normalize: true },
) => Promise<{ data: ArrayLike<number> }>;

let embedderPromise: Promise<Embedder> | null = null;

export function preloadQueryEmbedder() {
  embedderPromise ??= import("@huggingface/transformers")
    .then(async ({ pipeline }) =>
      (await pipeline("feature-extraction", MODEL)) as unknown as Embedder,
    )
    .catch((error: unknown) => {
      embedderPromise = null;
      throw error;
    });
  return embedderPromise;
}

export async function embedQuery(query: string) {
  const text = query.trim();
  if (text.length < 2 || text.length > 300) {
    throw new Error("질문은 2~300자로 입력해 주세요.");
  }

  const embedder = await preloadQueryEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  const vector = Array.from(output.data, Number);
  if (vector.length !== 384 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("질의 임베딩을 만들지 못했습니다.");
  }
  return vector;
}
