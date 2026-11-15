import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "News FB Fiesta — Otomasi berita ke Facebook",
  description: "Backend agregator berita RSS, ringkasan AI, news card, dan publikasi ke Facebook Page.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
