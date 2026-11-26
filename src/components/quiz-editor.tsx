"use client";
import { useCallback, useEffect, useState } from "react";
import { QUIZ_DIFFICULTIES, type QuizDifficulty, type QuizSource } from "@/lib/quiz-customization";

type Tile = { imageUrl: string; difficulty: QuizDifficulty };
export function QuizEditor({ editionId, previewUrl, secret, onChanged }: {
  editionId: string; previewUrl: string; secret: string; onChanged: () => Promise<unknown>;
}) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [initial, setInitial] = useState("");
  const [pool, setPool] = useState<QuizSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const api = useCallback(async (url: string, body?: unknown) => {
    const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Permintaan gagal.");
    return result;
  }, [secret]);
  useEffect(() => {
    let active = true;
    void api(`/api/admin/quiz-edit?id=${encodeURIComponent(editionId)}`).then(result => {
      if (!active) return;
      if (result.previewUrl !== previewUrl) throw new Error("Preview berubah. Muat ulang dashboard.");
      const next = (result.sources as QuizSource[]).map((s, i) => ({ imageUrl: s.imageUrl, difficulty: result.difficulties[i] as QuizDifficulty }));
      setTiles(next); setInitial(JSON.stringify(next)); setPool(result.candidates);
    }).catch(e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [api, editionId, previewUrl]);
  const dirty = JSON.stringify(tiles) !== initial;
  async function act(action: "edit" | "approve" | "reject") {
    if (action === "approve" && !window.confirm("Saya sudah memeriksa kelima petunjuk, caption, dan hak penggunaan gambar pada preview ini. Terbitkan?")) return;
    if (action === "reject" && !window.confirm("Tolak edisi kuis ini?")) return;
    setBusy(true); setMessage("");
    try {
      const result = await api(action === "edit" ? "/api/admin/quiz-edit" : "/api/quiz", { action, editionId, previewUrl, tiles });
      setMessage(action === "edit" ? "Preview baru siap. Periksa lagi sebelum publikasi." : result.detail || "Operasi selesai.");
      await onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Operasi gagal.");
    } finally { setBusy(false); }
  }
  return <div className="panel">
    <h3>Atur tantangan per nomor</h3>
    <p className="muted small-note">Mudah: blur ringan. Sedang: mosaik warna. Sulit: mosaik hitam-putih. Tidak ada penghapusan wajah atau sistem benar/salah.</p>
    {tiles.map((tile, i) => <div className="form-grid" key={i}>
      <label>Poster nomor {i + 1}<select disabled={busy} value={tile.imageUrl} onChange={e => setTiles(tiles.map((t, j) => j === i ? { ...t, imageUrl: e.target.value } : t))}>
        {pool.map(source => <option key={`${i}-${source.imageUrl}`} value={source.imageUrl} disabled={tiles.some((t, j) => j !== i && t.imageUrl === source.imageUrl)}>{source.title}</option>)}
      </select></label>
      <label>Tingkat kesulitan<select disabled={busy} value={tile.difficulty} onChange={e => setTiles(tiles.map((t, j) => j === i ? { ...t, difficulty: e.target.value as QuizDifficulty } : t))}>
        {Object.entries(QUIZ_DIFFICULTIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    </div>)}
    {tiles.length === 5 && <div className="actions">
      <button type="button" className="secondary-button" disabled={busy || !dirty} onClick={() => void act("edit")}>Buat preview perubahan</button>
      <button type="button" disabled={busy || dirty} onClick={() => void act("approve")}>Setujui & terbitkan preview</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void act("reject")}>Tolak edisi</button>
    </div>}
    {dirty && tiles.length === 5 && <p>Perubahan belum dirender. Gambar di atas masih preview lama; buat preview perubahan sebelum menyetujui.</p>}
    {tiles.length === 5 && pool.length <= 5 && <p className="muted small-note">Belum ada poster pengganti lain yang layak. Tambahkan review manual untuk memperluas pilihan.</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
