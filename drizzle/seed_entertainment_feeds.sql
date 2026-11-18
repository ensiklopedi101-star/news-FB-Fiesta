-- Idempotent seed for the entertainment RSS presets.
-- Run in the Neon SQL Editor after applying drizzle/0003_scheduled_harvest.sql.
-- Existing rows with the same feed_url are left unchanged.

INSERT INTO public.rss_sources
  (name, category, page_key, feed_url, language, keywords, active)
VALUES
  (
    'Soompi All News', 'ENTERTAINMENT', 'entertainment',
    'https://www.soompi.com/feed', 'en', ARRAY[]::text[], true
  ),
  (
    'Soompi Drama', 'DRAMA', 'entertainment',
    'https://www.soompi.com/category/tvfilm/drama/feed', 'en',
    ARRAY['drama', 'k-drama', 'c-drama', 'actor', 'actress', 'cast', 'episode', 'teaser'],
    true
  ),
  (
    'Soompi K-Pop', 'K-POP', 'entertainment',
    'https://www.soompi.com/category/music/feed', 'en', ARRAY[]::text[], true
  ),
  (
    'Yonhap Culture and K-Pop', 'K-POP', 'entertainment',
    'https://en.yna.co.kr/RSS/culture.xml', 'en',
    ARRAY['k-pop', 'kpop', 'idol', 'boy band', 'girl group', 'Korean pop', 'comeback', 'debut'], true
  ),
  (
    'Seoulbeats', 'K-POP', 'entertainment',
    'https://seoulbeats.com/feed/', 'en', ARRAY[]::text[], true
  ),
  (
    'Dramabeans', 'DRAMA', 'entertainment',
    'https://www.dramabeans.com/feed/', 'en', ARRAY[]::text[], true
  ),
  (
    'DramaPanda', 'DRAMA', 'entertainment',
    'https://dramapanda.com/feed/', 'en', ARRAY[]::text[], true
  ),
  (
    'DramaPanda C-News', 'C-DRAMA', 'entertainment',
    'https://dramapanda.com/category/c-news/feed', 'en', ARRAY[]::text[], true
  ),
  (
    'Overseasidol C-Drama', 'C-DRAMA', 'entertainment',
    'https://overseasidol.com/en/drama-movie/c-drama-en/feed/', 'en', ARRAY[]::text[], true
  ),
  (
    'Koala''s Playground', 'DRAMA', 'entertainment',
    'https://koalasplayground.com/feed/', 'en', ARRAY[]::text[], true
  ),
  (
    'HanCinema', 'DRAMA', 'entertainment',
    'https://feeds.feedburner.com/hancinema/AUJj', 'en', ARRAY[]::text[], false
  ),
  (
    'Google News Donghua', 'DONGHUA', 'entertainment',
    'https://news.google.com/rss/search?q=donghua+OR+%22Chinese+animation%22&hl=en-US&gl=US&ceid=US:en',
    'en', ARRAY[]::text[], false
  ),
  (
    'MyAnimeList News', 'DONGHUA', 'entertainment',
    'https://myanimelist.net/rss/news.xml', 'en',
    ARRAY['chinese', 'donghua', 'tencent', 'bilibili', 'youku', 'iqiyi'], true
  ),
  (
    'Yu Alexius Chinese Anime', 'DONGHUA', 'entertainment',
    'https://yualexius.com/category/chinese-anime/feed', 'en', ARRAY[]::text[], true
  ),
  (
    'My Donghua Review', 'DONGHUA', 'entertainment',
    'https://mydonghuareview.com/category/news/feed/', 'en', ARRAY[]::text[], true
  ),
  (
    'Anime News Network', 'MANGA', 'entertainment',
    'https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us', 'en',
    ARRAY['manga', 'comic', 'serialization', 'volume', 'chapter', 'shonen', 'seinen'], true
  ),
  (
    'Otaku News', 'MANGA', 'entertainment',
    'https://www.otakunews.com/rss/rss.xml', 'en', ARRAY[]::text[], true
  ),
  (
    'Crunchyroll News', 'MANGA', 'entertainment',
    'https://cr-news-api-service.prd.crunchyrollsvc.com/v1/en-US/rss', 'en',
    ARRAY['manga', 'kodansha', 'shueisha', 'viz'], true
  ),
  (
    'BehindTheManga', 'MANGA', 'entertainment',
    'https://www.behindthemanga.com/blog-feed.xml', 'en', ARRAY[]::text[], true
  ),
  (
    'Google News Webtoon Adaptation', 'WEBTOON', 'entertainment',
    'https://news.google.com/rss/search?q=%22webtoon+adaptation%22&hl=en-US&gl=US&ceid=US:en',
    'en', ARRAY[]::text[], false
  ),
  (
    'Google News Webtoon Release', 'WEBTOON', 'entertainment',
    'https://news.google.com/rss/search?q=%22webtoon+release%22&hl=en-US&gl=US&ceid=US:en',
    'en', ARRAY[]::text[], false
  )
ON CONFLICT (feed_url) DO NOTHING;
