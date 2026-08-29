import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taggi — Operação inteligente",
  description: "Contagens, etiquetas e expedição em um só lugar.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
