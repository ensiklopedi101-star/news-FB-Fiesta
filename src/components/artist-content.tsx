"use client";

import { useCallback, useEffect, useState } from "react";
import { ARTIST_SEGMENTS, canApproveArtist, canEditArtist, type ArtistInput } from "@/lib/artist-content";

type Item = {
  id: string; content: ArtistInput; status: string; revision: number; previewRevision: number | null;
  previewUrls: string[]; facebookPostId: string | null; publishedAt: string | null; errorMessage: string | null;
};
const blank = (): ArtistInput => ({ segment: "artist_bio", artist: "", headline: "", angle: "", question: "", caption: "", rightsConfirmed: false,
  slides: Array.from({ length: 4 }, () => ({ heading: "", fact: "", sourceUrl: "", imageUrl: "", imageSourceUrl: "", credit: "" })) });

export function ArtistContentPanel({ secret }: { secret: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [form, setForm] = useState<ArtistInput>(blank);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const api = useCallback(async (body?: unknown) => {
    const response = await fetch("/api/admin/artist-content", { method: body ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Permintaan gagal.");
    return result;
  }, [secret]);
  const refresh = useCallback(async () => { const result = await api(); setItems(result.items); return result.items as Item[]; }, [api]);
  useEffect(() => { void refresh().catch(e => setMessage(e.message)); }, [refresh]);
  const edit = (next: ArtistInput) => { setForm(next); setDirty(true); };
  const choose = (item: Item | null) => {
    if (dirty && !window.confirm("Buang perubahan yang belum disimpan?")) return;
    setSelected(item); setForm(item?.content ?? blank()); setDirty(false); setMessage("");
  };
  async function act(action: "save" | "preview" | "approve" | "ai") {
    if (action === "approve" && !window.confirm("Saya sudah memeriksa empat slide, fakta, sumber, caption, dan hak foto. Terbitkan preview tersimpan ini sekarang?")) return;
    setBusy(true); setMessage("");
    try {
      const result = await api({ action, id: selected?.id, revision: selected?.revision, content: form });
      if (action === "ai") {
        setForm({ ...form, caption: result.caption }); setDirty(true);
        setMessage("Usulan AI belum disimpan. Verifikasi setiap klaim, lalu simpan dan buat preview baru.");
      } else {
        const rows = await refresh();
        const item = result.item ?? rows.find(r => r.id === selected?.id);
        if (item) { setSelected(item); setForm(item.content); setDirty(false); }
        setMessage(action === "approve" ? "Publikasi Facebook berhasil. Periksa status mirror Instagram di bawah." : action === "preview" ? "Preview siap diperiksa. Belum dipublikasikan." : "Draf tersimpan. Buat preview sebelum publikasi.");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Operasi gagal.");
      const rows = await refresh().catch(() => null);
      const current = rows?.find(r => r.id === selected?.id);
      if (current && !dirty) { setSelected(current); setForm(current.content); }
    } finally { setBusy(false); }
  }
  const locked = selected ? !canEditArtist(selected.status) : false;
  return <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">PROGRAM POPBEEZ</p><h2>Konten Artis</h2>
      <p>Bio Artis dan Sorotan Artis/Idol · empat slide · draf → preview → persetujuan → Facebook. Terpisah dari antrean RSS otomatis.</p></div></div>
    <p className="muted small-note">Gunakan fakta yang sudah diverifikasi dan foto yang boleh digunakan. Mencantumkan kredit bukan pengganti izin. Sumber tidak diambil otomatis; AI hanya mendapat bahan yang Anda isi.</p>
    <div className="form-grid">
      <label>Edisi tersimpan<select disabled={busy} value={selected?.id ?? ""} onChange={e => choose(items.find(i => i.id === e.target.value) ?? null)}>
        <option value="">Draf baru</option>{items.map(item => <option key={item.id} value={item.id}>{item.content.headline} · {item.status} · r{item.revision}</option>)}
      </select></label>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh().catch(e => setMessage(e.message))}>Muat ulang daftar</button>
    </div>
    <form onSubmit={e => { e.preventDefault(); void act("save"); }}>
      <fieldset disabled={busy || locked} style={{ border: 0, padding: 0 }}>
        <div className="form-grid">
          <label>Segmen<select value={form.segment} onChange={e => edit({ ...form, segment: e.target.value as ArtistInput["segment"] })}>{Object.entries(ARTIST_SEGMENTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Nama artis<input required minLength={2} maxLength={80} value={form.artist} onChange={e => edit({ ...form, artist: e.target.value })} /></label>
          <label>Judul/tema<input required minLength={5} maxLength={100} value={form.headline} onChange={e => edit({ ...form, headline: e.target.value })} /></label>
          <label>Sudut editorial PopBeez<textarea required minLength={10} maxLength={500} value={form.angle} onChange={e => edit({ ...form, angle: e.target.value })} /></label>
          <label>Pertanyaan untuk Beezers<textarea required minLength={10} maxLength={200} value={form.question} onChange={e => edit({ ...form, question: e.target.value })} /></label>
        </div>
        {form.slides.map((slide, index) => <div className="panel" key={index}>
          <h3>Slide {index + 1} — {form.segment === "artist_bio" ? ["Perkenalan", "Awal perjalanan", "Karya penting", "Konteks & sudut pandang"][index] : "Foto & konteks"}</h3>
          <div className="form-grid">{([ ["heading", "Judul slide", 55], ["fact", "Fakta/konteks terverifikasi", 220], ["sourceUrl", "URL sumber fakta", 2000], ["imageUrl", "URL langsung foto HTTPS", 2000], ["imageSourceUrl", "URL halaman sumber foto", 2000], ["credit", "Kredit foto", 45] ] as const).map(([key, label, max]) => <label key={key}>{label}
            <input required type={key.endsWith("Url") ? "url" : "text"} maxLength={max} value={slide[key]} onChange={e => edit({ ...form, slides: form.slides.map((s, i) => i === index ? { ...s, [key]: e.target.value } : s) })} />
          </label>)}</div>
        </div>)}
        <label><input type="checkbox" checked={form.rightsConfirmed} required onChange={e => edit({ ...form, rightsConfirmed: e.target.checked })} /> Saya sudah memeriksa hak penggunaan keempat foto dan sumber faktanya.</label>
        <label>Caption (kosongkan untuk susunan otomatis tanpa AI)<textarea rows={12} maxLength={10000} value={form.caption} onChange={e => edit({ ...form, caption: e.target.value })} /></label>
        <p className="muted small-note">Jika fakta diubah, sesuaikan caption juga. AI adalah bantuan penulisan, bukan pemeriksa kebenaran.</p>
        <button type="submit" disabled={busy}>Simpan draf</button>{" "}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void act("ai")}>Bantu susun caption dengan AI</button>
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}
    {selected && <div>
      <p>Status: <b>{selected.status}</b> · revisi {selected.revision}{dirty ? " · perubahan belum disimpan" : ""}</p>
      {selected.errorMessage && <p className="article-error">{selected.errorMessage}</p>}
      <button type="button" className="secondary-button" disabled={busy || dirty || selected.status !== "draft"} onClick={() => void act("preview")}>Buat preview revisi tersimpan</button>
      {selected.previewUrls.length > 0 && <div>
        <p>Preview publik di Blob. Periksa urutan, keterbacaan teks, foto, dan kredit keempat slide.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>{selected.previewUrls.map((url, i) => <a href={url} target="_blank" rel="noreferrer" key={url}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`Preview slide ${i + 1}`} style={{ width: "100%" }} />
        </a>)}</div>
        <h3>Caption tersimpan yang akan diterbitkan</h3><p style={{ whiteSpace: "pre-wrap" }}>{selected.content.caption}</p>
        {canApproveArtist(selected) && <button type="button" disabled={busy || dirty} onClick={() => void act("approve")}>Setujui & terbitkan empat slide</button>}
      </div>}
      {selected.facebookPostId && <p><a href={`https://www.facebook.com/${selected.facebookPostId}`} target="_blank" rel="noreferrer">Buka post Facebook ↗</a> · {selected.publishedAt ? new Date(selected.publishedAt).toLocaleString("id-ID") : ""}</p>}
      {locked && <p className="muted small-note">Edisi terkunci. Jika rendering/publishing tertahan atau publikasi gagal, periksa log dan Facebook sebelum tindakan manual. Tidak ada retry otomatis.</p>}
    </div>}
  </section>;
}
