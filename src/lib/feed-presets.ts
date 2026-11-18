export type FeedPreset = {
  name: string;
  category: string;
  pageKey: "news" | "entertainment";
  feedUrl: string;
  language: string;
  keywords: string[];
  active: boolean;
};

/** Starter sources based on the user's list. Google News feeds are disabled until the user reviews their usage terms. */
export const feedPresets: FeedPreset[] = [
  { name: "Soompi All News", category: "ENTERTAINMENT", pageKey: "entertainment", feedUrl: "https://www.soompi.com/feed", language: "en", keywords: [], active: true },
  { name: "Soompi Drama", category: "DRAMA", pageKey: "entertainment", feedUrl: "https://www.soompi.com/category/tvfilm/drama/feed", language: "en", keywords: ["drama", "k-drama", "c-drama", "actor", "actress", "cast", "episode", "teaser"], active: true },
  { name: "Seoulbeats", category: "K-POP", pageKey: "entertainment", feedUrl: "https://seoulbeats.com/feed/", language: "en", keywords: [], active: true },
  { name: "Soompi K-Pop", category: "K-POP", pageKey: "entertainment", feedUrl: "https://www.soompi.com/category/music/feed", language: "en", keywords: [], active: true },
  { name: "Yonhap Culture and K-Pop", category: "K-POP", pageKey: "entertainment", feedUrl: "https://en.yna.co.kr/RSS/culture.xml", language: "en", keywords: ["k-pop", "kpop", "idol", "boy band", "girl group", "Korean pop", "comeback", "debut"], active: true },
  { name: "Dramabeans", category: "DRAMA", pageKey: "entertainment", feedUrl: "https://www.dramabeans.com/feed/", language: "en", keywords: [], active: true },
  { name: "DramaPanda", category: "DRAMA", pageKey: "entertainment", feedUrl: "https://dramapanda.com/feed/", language: "en", keywords: [], active: true },
  { name: "DramaPanda C-News", category: "C-DRAMA", pageKey: "entertainment", feedUrl: "https://dramapanda.com/category/c-news/feed", language: "en", keywords: [], active: true },
  { name: "Overseasidol C-Drama", category: "C-DRAMA", pageKey: "entertainment", feedUrl: "https://overseasidol.com/en/drama-movie/c-drama-en/feed/", language: "en", keywords: [], active: true },
  { name: "Koala's Playground", category: "DRAMA", pageKey: "entertainment", feedUrl: "https://koalasplayground.com/feed/", language: "en", keywords: [], active: true },
  { name: "HanCinema", category: "DRAMA", pageKey: "entertainment", feedUrl: "https://feeds.feedburner.com/hancinema/AUJj", language: "en", keywords: [], active: false },
  { name: "Google News Donghua", category: "DONGHUA", pageKey: "entertainment", feedUrl: "https://news.google.com/rss/search?q=donghua+OR+%22Chinese+animation%22&hl=en-US&gl=US&ceid=US:en", language: "en", keywords: [], active: false },
  { name: "MyAnimeList News", category: "DONGHUA", pageKey: "entertainment", feedUrl: "https://myanimelist.net/rss/news.xml", language: "en", keywords: ["chinese", "donghua", "tencent", "bilibili", "youku", "iqiyi"], active: true },
  { name: "Yu Alexius Chinese Anime", category: "DONGHUA", pageKey: "entertainment", feedUrl: "https://yualexius.com/category/chinese-anime/feed", language: "en", keywords: [], active: true },
  { name: "My Donghua Review", category: "DONGHUA", pageKey: "entertainment", feedUrl: "https://mydonghuareview.com/category/news/feed/", language: "en", keywords: [], active: true },
  { name: "Anime News Network", category: "MANGA", pageKey: "entertainment", feedUrl: "https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us", language: "en", keywords: ["manga", "comic", "serialization", "volume", "chapter", "shonen", "seinen"], active: true },
  { name: "Otaku News", category: "MANGA", pageKey: "entertainment", feedUrl: "https://www.otakunews.com/rss/rss.xml", language: "en", keywords: [], active: true },
  { name: "Crunchyroll News", category: "MANGA", pageKey: "entertainment", feedUrl: "https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss", language: "en", keywords: ["manga", "kodansha", "shueisha", "viz"], active: true },
  { name: "BehindTheManga", category: "MANGA", pageKey: "entertainment", feedUrl: "https://www.behindthemanga.com/blog-feed.xml", language: "en", keywords: [], active: true },
  { name: "Google News Webtoon Adaptation", category: "WEBTOON", pageKey: "entertainment", feedUrl: "https://news.google.com/rss/search?q=%22webtoon+adaptation%22&hl=en-US&gl=US&ceid=US:en", language: "en", keywords: [], active: false },
  { name: "Google News Webtoon Release", category: "WEBTOON", pageKey: "entertainment", feedUrl: "https://news.google.com/rss/search?q=%22webtoon+release%22&hl=en-US&gl=US&ceid=US:en", language: "en", keywords: [], active: false },
];
