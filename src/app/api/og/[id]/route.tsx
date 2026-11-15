import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { isSafePublicImageUrl } from "@/lib/safe-url";

/* eslint-disable @next/next/no-img-element */

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [article] = await getDb().select({ title: articles.title, category: articles.category, sourceName: articles.sourceName, imageUrl: articles.imageUrl })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return new Response("Not found", { status: 404 });

  const brand = (process.env.PAGE_BRAND || "Kabar Nusra").slice(0, 40);
  const category = article.category.toUpperCase().slice(0, 24);
  const title = article.title.slice(0, 130);
  const image = isSafePublicImageUrl(article.imageUrl) ? article.imageUrl : null;
  const logo = isSafePublicImageUrl(process.env.PAGE_LOGO_URL) ? process.env.PAGE_LOGO_URL : null;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#101b2d", color: "#fff", fontFamily: "Arial, sans-serif" }}>
        <div style={{ height: 120, padding: "30px 54px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#102a43" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 42, fontWeight: 800 }}>
            {logo ? <img src={logo} alt="Logo halaman" width="58" height="58" style={{ width: 58, height: 58, borderRadius: 18, objectFit: "cover" }} /> : <div style={{ width: 58, height: 58, borderRadius: 18, background: "#f5b82e", color: "#102a43", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34 }}>N</div>}
            {brand}
          </div>
          <div style={{ background: "#e84736", borderRadius: 99, padding: "14px 28px", fontSize: 25, fontWeight: 800, letterSpacing: 2 }}>{category}</div>
        </div>
        <div style={{ height: 650, width: "100%", display: "flex", position: "relative", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "linear-gradient(135deg, #176b87, #102a43)" }}>
          {image ? <img src={image} alt="Foto dari sumber berita" width="1080" height="650" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ fontSize: 90, color: "#ffffff55", fontWeight: 800, letterSpacing: 12 }}>BERITA</div>}
          <div style={{ position: "absolute", left: 54, bottom: 34, background: "#101b2dcc", borderRadius: 12, padding: "12px 20px", fontSize: 23 }}>{article.sourceName}</div>
        </div>
        <div style={{ flex: 1, padding: "52px 58px 42px", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f7f5ef", color: "#102a43" }}>
          <div style={{ fontSize: 58, lineHeight: 1.16, fontWeight: 800, letterSpacing: -1 }}>{title}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "4px solid #e84736", paddingTop: 20, fontSize: 23, color: "#53657a" }}>
            <span>RINGKASAN BERITA</span>
            <span>{brand}</span>
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
