import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'Tage Beta — Contagens em tempo real',
  description:
    'Uma experiência premium e direta para acompanhar contagens por plataforma.',
  openGraph: {
    title: 'Tage Beta — Contagens em tempo real',
    description: 'Premium. Rápido. Elegante.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Tage Beta — Contagens em tempo real',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tage Beta — Contagens em tempo real',
    description: 'Premium. Rápido. Elegante.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body>{children}</body>
    </html>
  );
}
