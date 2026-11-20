/**
 * Facebook can down-rank a Page that only re-publishes other people's reporting.
 * Every generated caption therefore has to carry a *substantial addition*: the
 * writer's own analysis, an opinion, and something new for the reader. This module
 * measures that in a deterministic way so the pipeline can hold weak posts back
 * instead of gambling with the Page's monetisation status.
 */
export type OriginalityBand = "safe" | "watch" | "risky";

export type OriginalitySignals = {
  /** Explicit editorial opinion ("menurut kami…"), not just a summary. */
  opinion: boolean;
  /** Causal / comparative reasoning instead of a plain recap. */
  analysis: boolean;
  /** A concrete discussion question for the audience. */
  question: boolean;
  /** Mostly new wording rather than the source's vocabulary. */
  context: boolean;
  /** No sentence copied verbatim from the source. */
  noVerbatim: boolean;
};

export type OriginalityReport = {
  /** 0–100; higher is more clearly the Page's own work. */
  score: number;
  band: OriginalityBand;
  /** Share of the caption's word-shingles that also appear in the source. */
  overlap: number;
  /** Longest run of identical words shared with the source. */
  longestRun: number;
  signals: OriginalitySignals;
  reasons: string[];
};

/** A verbatim run this long is copy-paste, however the rest of the caption reads. */
const VERBATIM_RUN_LIMIT = 8;
const SHINGLE_SIZE = 6;
const DEFAULT_MIN_SCORE = 45;

function words(text: string): string[] {
  return text
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(tokens: string[], size: number): Set<string> {
  const output = new Set<string>();
  for (let index = 0; index + size <= tokens.length; index += 1) {
    output.add(tokens.slice(index, index + size).join(" "));
  }
  return output;
}

/** Longest common contiguous word run; guards against "paraphrase" that is really a paste. */
function longestCommonRun(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  let previous = new Array<number>(right.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1]! + 1;
        if (current[j]! > best) best = current[j]!;
      }
    }
    previous = current;
  }
  return best;
}

const OPINION_MARKERS = /\b(menurut (?:kami|saya|redaksi|gue)|kami menilai|saya (?:rasa|lihat|kira|pikir)|jujur(?:nya)?|yang bikin|menariknya|sayangnya|justru|patut|kami (?:anggap|catat)|buat (?:kami|saya)|di mata kami)\b/i;
const ANALYSIS_MARKERS = /\b(karena|sehingga|artinya|dampak(?:nya)?|dibanding(?:kan)?|padahal|kontras|membandingkan|implikasi|pola|tren|sinyal|konteksnya|makanya|alhasil)\b/i;

export type OriginalityInput = {
  /** Full caption, exactly as it would be posted. */
  caption: string;
  /** The editorial paragraph (opinion/analysis). */
  take?: string;
  /** The discussion question. */
  question?: string;
  /** Source material the caption was derived from. */
  sourceText: string;
  /** Source headline, excluded from the verbatim check as it is quoted for context. */
  title?: string;
};

/** Scores how much of the caption is the Page's own work rather than the source's. */
export function scoreOriginality(input: OriginalityInput): OriginalityReport {
  const captionWords = words(input.caption);
  const sourceWords = words(`${input.title ?? ""} ${input.sourceText}`.slice(0, 6_000));
  const captionShingles = shingles(captionWords, SHINGLE_SIZE);
  const sourceShingles = shingles(sourceWords, SHINGLE_SIZE);

  let shared = 0;
  for (const shingle of captionShingles) if (sourceShingles.has(shingle)) shared += 1;
  const overlap = captionShingles.size ? shared / captionShingles.size : 0;
  const longestRun = longestCommonRun(captionWords, sourceWords);

  const take = input.take?.trim() || "";
  const question = input.question?.trim() || input.caption.split("\n").find((line) => line.trim().endsWith("?")) || "";
  const signals: OriginalitySignals = {
    opinion: OPINION_MARKERS.test(take || input.caption),
    analysis: ANALYSIS_MARKERS.test(take) && take.length >= 60,
    question: question.length >= 25 && question.includes("?"),
    context: captionWords.length >= 60 && overlap < 0.25,
    noVerbatim: longestRun < VERBATIM_RUN_LIMIT,
  };

  let score = 100 - Math.round(overlap * 160) - Math.max(0, longestRun - 4) * 5;
  if (!signals.opinion) score -= 18;
  if (!signals.analysis) score -= 15;
  if (!signals.question) score -= 8;
  if (!signals.context) score -= 10;
  if (!signals.noVerbatim) score -= 45;
  // A caption too thin to show its own reporting can never be rated "safe".
  if (!signals.context) score = Math.min(score, 60);
  score = Math.max(0, Math.min(100, score));

  const reasons: string[] = [];
  if (!signals.noVerbatim) reasons.push(`Ada ${longestRun} kata berurutan yang sama dengan sumber — potong dan tulis ulang.`);
  if (overlap > 0.25) reasons.push(`Terlalu banyak frasa sumber (${Math.round(overlap * 100)}% shingle masih sama).`);
  if (!signals.opinion) reasons.push("Belum ada opini redaksi yang jelas (mis. “Menurut kami…”).");
  if (!signals.analysis) reasons.push("Belum ada analisis: hubungkan sebab-akibat, tren, atau perbandingan.");
  if (!signals.question) reasons.push("Pertanyaan diskusi belum cukup spesifik.");
  if (!reasons.length) reasons.push("Ada fakta, analisis, opini, dan pertanyaan — nilai tambah cukup.");

  const band: OriginalityBand = score >= 65 ? "safe" : score >= minimumOriginalityScore() ? "watch" : "risky";
  return { score, band, overlap: Number(overlap.toFixed(3)), longestRun, signals, reasons };
}

const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * How many drafts one article may use before the guard gives up. Two is the
 * ceiling on purpose: every attempt costs an AI call inside the cron budget.
 */
export function originalityMaxAttempts(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.ORIGINALITY_MAX_ATTEMPTS?.trim());
  if (!Number.isFinite(configured)) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(2, Math.max(1, Math.round(configured)));
}

/** True while a failed draft may still be rewritten automatically. */
export function shouldRetryForOriginality(
  report: OriginalityReport,
  attemptsUsed: number,
  maxAttempts: number = originalityMaxAttempts(),
): boolean {
  return originalityBlocked(report) && attemptsUsed < maxAttempts;
}

/** Captions scoring below this are held instead of published. */
export function minimumOriginalityScore(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.ORIGINALITY_MIN_SCORE?.trim());
  return Number.isFinite(configured) && configured >= 0 && configured <= 90 ? Math.round(configured) : DEFAULT_MIN_SCORE;
}

export function originalityBlocked(report: OriginalityReport, env: Record<string, string | undefined> = process.env): boolean {
  return report.score < minimumOriginalityScore(env);
}

/** Short Indonesian label for the dashboard and logs. */
export function originalityLabel(band: OriginalityBand): string {
  if (band === "safe") return "Aman";
  if (band === "watch") return "Pantau";
  return "Berisiko";
}
