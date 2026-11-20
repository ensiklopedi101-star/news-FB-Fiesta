import { witaDayNumber, witaMinutes, witaWeekday } from "./publish-slots";

/**
 * "Tebak Drama" runs every two weeks: five posters taken from the manual reviews
 * already published for PopBeez, because those posters are the dramas/films the
 * audience already recognises. There is no answer key by design.
 */
export const QUIZ_TILES = 5;
export const QUIZ_LABEL = "TEBAK DRAMA";
export const QUIZ_SUBLABEL = "5 poster · jawab di komentar";
/** A poster may appear in at most this many editions, so the pool keeps rotating. */
export const QUIZ_MAX_USES = 3;

export const QUIZ_SCHEDULE = {
  /** 0 = Sunday, in WITA. */
  weekdayWita: 0,
  /** 19:15 WITA. */
  minutes: 19 * 60 + 15,
  graceMinutes: 14,
  intervalDays: 14,
} as const;

export const QUIZ_SCHEDULE_LABEL = "Minggu 19:15 WITA, tiap 14 hari";

export function quizIntervalDays(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.QUIZ_INTERVAL_DAYS?.trim());
  return Number.isFinite(configured) && configured >= 1 ? Math.round(configured) : QUIZ_SCHEDULE.intervalDays;
}

export type QuizPoster = {
  /** Review article the poster came from. */
  reviewId: string;
  reviewCreatedAt: Date;
  title: string;
  imageUrl: string;
};

/** Stable key for a poster: used to mark which dramas already appeared in past quizzes. */
export function posterKey(imageUrl: string): string {
  return imageUrl.trim();
}

/** Lowercased title without punctuation, so "Vincenzo" and "vincenzo!" are the same drama. */
export function posterTitleKey(title: string): string {
  return title.toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export type QuizReview = {
  id: string;
  createdAt: Date;
  items: Array<{ title: string; imageUrl: string }>;
};

/**
 * Flattens reviews into posters, newest review first, keeping only the first
 * poster per title so a drama featured in two reviews is not shown twice.
 */
export function quizPostersFromReviews(reviews: readonly QuizReview[]): QuizPoster[] {
  const seenTitles = new Set<string>();
  const seenImages = new Set<string>();
  const posters: QuizPoster[] = [];
  for (const review of [...reviews].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    for (const item of review.items) {
      if (!/^https:\/\//i.test(item.imageUrl ?? "")) continue;
      if (!item.title?.trim()) continue;
      const titleKey = posterTitleKey(item.title);
      const imageKey = posterKey(item.imageUrl);
      if (!titleKey || seenTitles.has(titleKey) || seenImages.has(imageKey)) continue;
      seenTitles.add(titleKey);
      seenImages.add(imageKey);
      posters.push({ reviewId: review.id, reviewCreatedAt: review.createdAt, title: item.title.trim(), imageUrl: item.imageUrl });
    }
  }
  return posters;
}

/**
 * Counts how many editions each poster already appeared in. Every edition stores
 * the poster keys it used, so the history itself is the "sudah dipakai" marker.
 * A poster listed twice inside one edition still counts once.
 */
export function quizPosterUsage(
  editions: ReadonlyArray<{ posterKeys?: readonly string[] | null }>,
): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const edition of editions) {
    for (const key of new Set(edition.posterKeys ?? [])) {
      if (!key) continue;
      usage[key] = (usage[key] ?? 0) + 1;
    }
  }
  return usage;
}

/** Posters that still have appearances left, i.e. used fewer than `maxUses` times. */
export function quizAvailablePosters(
  posters: readonly QuizPoster[],
  options: { usage?: Record<string, number>; maxUses?: number } = {},
): QuizPoster[] {
  const usage = options.usage ?? {};
  const maxUses = options.maxUses ?? QUIZ_MAX_USES;
  return posters.filter((poster) => (usage[posterKey(poster.imageUrl)] ?? 0) < maxUses);
}

/**
 * Picks the tiles for one edition at random from the posters that still have
 * appearances left, then shows them newest review first. `random` is injectable
 * so tests can pin the shuffle.
 */
export function selectQuizPosters(
  posters: readonly QuizPoster[],
  options: { count?: number; usage?: Record<string, number>; maxUses?: number; random?: () => number } = {},
): QuizPoster[] {
  const count = options.count ?? QUIZ_TILES;
  const random = options.random ?? Math.random;
  const pool = [...quizAvailablePosters(posters, options)];

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }

  return pool.slice(0, count).sort((a, b) => b.reviewCreatedAt.getTime() - a.reviewCreatedAt.getTime());
}

/** Caption stays link-free so Facebook keeps its organic reach; the quiz needs no answer key. */
export function buildQuizCaption(): string {
  return [
    `${QUIZ_LABEL} 🕵️`,
    "",
    "Tebak judul drama/film. Berapa yang berhasil kamu tebak?",
    "",
    "Ikuti PopBeez untuk Kuiz Berikutnya.",
    "Follow juga Instagram @popbeez.hive biar gak ketinggalan kuisnya. 🐝",
    "",
    "#TebakDramanya #Drakor #Kdrama #FilmKorea #PopBeez",
  ].join("\n");
}

export type QuizDueState = { due: boolean; reason: string };

/**
 * True only inside the Sunday 19:15 WITA window and when the previous edition is
 * at least `intervalDays` WITA days old, so a daily cron posts every second Sunday.
 */
export function shouldPostQuiz(
  now: Date,
  lastPostedAt: Date | null,
  options: { intervalDays?: number; schedule?: typeof QUIZ_SCHEDULE } = {},
): QuizDueState {
  const schedule = options.schedule ?? QUIZ_SCHEDULE;
  const intervalDays = options.intervalDays ?? QUIZ_SCHEDULE.intervalDays;
  const weekday = witaWeekday(now);
  const minutes = witaMinutes(now);

  if (weekday !== schedule.weekdayWita) {
    return { due: false, reason: "Kuis hanya diposting hari Minggu (WITA). Hari ini bukan Minggu." };
  }
  if (minutes < schedule.minutes || minutes >= schedule.minutes + schedule.graceMinutes) {
    return { due: false, reason: "Di luar jendela kuis Minggu 19:15–19:29 WITA." };
  }
  if (lastPostedAt) {
    const gap = witaDayNumber(now) - witaDayNumber(lastPostedAt);
    if (gap < intervalDays) {
      return { due: false, reason: `Edisi terakhir ${gap} hari lalu; interval ${intervalDays} hari.` };
    }
  }
  return { due: true, reason: "Jendela kuis aktif." };
}
