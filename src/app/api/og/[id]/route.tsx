import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { fetchOgImageDataUrl } from "@/lib/og-image";
import { isSafePublicImageUrl } from "@/lib/safe-url";

/* eslint-disable @next/next/no-img-element */

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [article] = await getDb().select({ title: articles.title, category: articles.category, pageKey: articles.pageKey, sourceName: articles.sourceName, imageUrl: articles.imageUrl, sourceUrl: articles.sourceUrl })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return new Response("Not found", { status: 404 });

  const isEntertainment = article.pageKey === "entertainment";
  const pageBrand = isEntertainment ? process.env.PAGE_BRAND_ENTERTAINMENT : process.env.PAGE_BRAND_NEWS;
  const brand = (pageBrand || process.env.PAGE_BRAND || (isEntertainment ? "Popbeez" : "Nusabeez")).slice(0, 40);
  const category = article.category.toUpperCase().replace(/[^\p{L}\p{N}\s-]/gu, "").slice(0, 24);
  const title = article.title.slice(0, 130);
  const image = await fetchOgImageDataUrl(article.imageUrl, article.sourceUrl);
  const localOrigin = process.env.APP_URL || new URL(request.url).origin;
  const localLogo = new URL(`/brand/${isEntertainment ? "popbeez_icon.png" : "nusabeez_icon.png"}`, localOrigin).toString();
  const customLogo = isEntertainment ? process.env.PAGE_LOGO_ENTERTAINMENT_URL : process.env.PAGE_LOGO_NEWS_URL;
  const logoCandidate = customLogo || process.env.PAGE_LOGO_URL || localLogo;
  const logo = isSafePublicImageUrl(logoCandidate) ? logoCandidate : localLogo;
  const palette = isEntertainment
    ? { dark: "#641735", accent: "#e42d80", light: "#fff3f8", soft: "#ffc84a" }
    : { dark: "#173b61", accent: "#e44d47", light: "#f3f7fc", soft: "#f7c84b" };

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: palette.light, color: "#1f2937", fontFamily: "Arial, sans-serif" }}>
        <div style={{ height: 132, padding: "24px 48px", display: "flex", alignItems: "center", justifyContent: "space-between", background: palette.dark, color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 42, fontWeight: 800 }}>
            <img src={logo} alt={`${brand} logo`} width="86" height="86" style={{ width: 86, height: 86, objectFit: "contain" }} />
            <span>{brand}</span>
          </div>
          <div style={{ background: palette.accent, borderRadius: 99, padding: "14px 26px", fontSize: 24, fontWeight: 800, letterSpacing: 2 }}>{category}</div>
        </div>
        <div style={{ height: 660, width: "100%", display: "flex", position: "relative", alignItems: "center", justifyContent: "center", overflow: "hidden", background: `linear-gradient(135deg, ${palette.dark}, ${palette.accent})` }}>
          {image ? (
            <>
              <img src={image} alt="Foto dari sumber berita" width="1080" height="660" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, #11182799 0%, transparent 55%)" }} />
            </>
          ) : (
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", overflow: "hidden", background: `linear-gradient(135deg, ${palette.dark}, ${palette.accent})`, color: "#fff" }}>
              <div style={{ position: "absolute", top: 52, right: 110, width: 350, height: 350, borderRadius: 999, background: palette.soft, opacity: 0.2 }} />
              <div style={{ position: "absolute", bottom: -160, left: 70, width: 540, height: 540, borderRadius: 999, border: `22px solid ${palette.soft}`, opacity: 0.24 }} />
              <div style={{ position: "relative", fontSize: 34, letterSpacing: 8, fontWeight: 700, opacity: 0.9 }}>{isEntertainment ? "POP CULTURE" : "KABAR NUSANTARA"}</div>
              <div style={{ position: "relative", marginTop: 20, fontSize: 82, fontWeight: 900, letterSpacing: 3 }}>{brand.toUpperCase()}</div>
              <div style={{ position: "relative", marginTop: 20, borderRadius: 99, padding: "12px 28px", background: palette.soft, color: palette.dark, fontSize: 25, fontWeight: 800 }}>{category}</div>
          </div>
          )}
          <div style={{ position: "absolute", left: 48, bottom: 28, background: "#101b2dcc", borderRadius: 12, padding: "12px 20px", fontSize: 23, color: "#fff" }}>{article.sourceName}</div>
        </div>
        <div style={{ flex: 1, padding: "42px 54px 34px", display: "flex", flexDirection: "column", justifyContent: "space-between", background: palette.light, color: palette.dark }}>
          <div style={{ fontSize: 58, lineHeight: 1.16, fontWeight: 800, letterSpacing: -1 }}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `4px solid ${palette.accent}`, paddingTop: 18, fontSize: 23, color: "#53657a" }}>
            <span>RINGKASAN BERITA</span>
            <span>{brand}</span>
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
