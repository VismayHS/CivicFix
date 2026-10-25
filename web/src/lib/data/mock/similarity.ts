/**
 * Stand-in for embedding similarity while Qdrant is not connected.
 * Bag-of-concepts cosine: words are folded onto shared concepts so paraphrases
 * ("pothole" / "crater on the road") still match. The postgres implementation
 * replaces this with all-MiniLM-L6-v2 embeddings + Qdrant cosine search.
 */

const CONCEPTS: Record<string, string[]> = {
  pothole: ["pothole", "potholes", "crater", "hole", "caved", "cave", "dent", "pit"],
  road: ["road", "roads", "street", "lane", "stretch", "junction", "signal", "surface"],
  footpath: ["footpath", "pavement", "sidewalk", "slab", "slabs", "tile", "tiles"],
  garbage: ["garbage", "trash", "waste", "rubbish", "litter", "bags", "dump", "dumped", "dumping", "debris", "rubble"],
  collect: ["collected", "collection", "pickup", "skipped", "vehicle"],
  water: ["water", "pipeline", "pipe", "supply", "tap", "tanker"],
  leak: ["leak", "leaking", "leakage", "burst", "flowing", "flooded", "flood", "gushing"],
  sewage: ["sewage", "sewer", "manhole", "drainage", "smell"],
  light: ["streetlight", "streetlights", "light", "lights", "lamp", "lamps", "dark", "darkness"],
  wire: ["wire", "cable", "electrical", "electric", "live", "pole", "shock"],
  drain: ["drain", "drains", "culvert", "choked", "blocked", "silt", "clogged"],
  rain: ["rain", "rainwater", "waterlogging", "waterlogged", "logging"],
  mosquito: ["mosquito", "mosquitoes", "dengue", "larvae", "stagnant", "fogging", "breeding"],
  dog: ["dog", "dogs", "stray", "animal", "animals", "pack"],
  tree: ["tree", "trees", "branch", "branches", "fallen", "fell"],
  park: ["park", "playground", "swing", "swings", "bench", "benches"],
};

const STOP = new Set(
  "a an the of on at in near for to and or is are was were has have had been be it this that from with by our my we there here not no every since after days day two three week weeks night morning".split(" "),
);

const LOOKUP = new Map<string, string>();
for (const [concept, words] of Object.entries(CONCEPTS)) for (const w of words) LOOKUP.set(w, concept);

export function conceptVector(text: string): Map<string, number> {
  const v = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const key = LOOKUP.get(raw) ?? LOOKUP.get(raw.replace(/(ing|ed|s)$/, "")) ?? raw;
    // Concepts weigh more than incidental words (place names etc.)
    v.set(key, (v.get(key) ?? 0) + (LOOKUP.has(raw) ? 2 : 0.6));
  }
  return v;
}

export function similarity(a: string, b: string): number {
  const va = conceptVector(a);
  const vb = conceptVector(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of va) {
    na += x * x;
    const y = vb.get(k);
    if (y) dot += x * y;
  }
  for (const y of vb.values()) nb += y * y;
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Deterministic 384-d unit vector for the Vector Console preview. */
export function pseudoEmbedding(text: string, dims = 384): number[] {
  const out = new Array<number>(dims).fill(0);
  for (const [k, w] of conceptVector(text)) {
    let h = 2166136261;
    for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
    for (let j = 0; j < 6; j++) {
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
      out[Math.abs(h) % dims] += (h & 1 ? 1 : -1) * w;
    }
  }
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map((x) => +(x / norm).toFixed(4));
}
