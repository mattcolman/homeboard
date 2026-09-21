import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Homeboard — Your household, at a glance',
  description: 'An AI-native household dashboard concept for the kitchen.',
  openGraph: {
    title: 'Homeboard',
    description: 'Your household, at a glance',
    images: [{ url: '/og.png', width: 1792, height: 939, alt: 'Homeboard — Your household, at a glance' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Homeboard',
    description: 'Your household, at a glance',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
