import type { Metadata, Viewport } from 'next';
import { Playfair_Display } from 'next/font/google';

import { AuthProvider } from '@/components/auth/AuthProvider';

import './globals.css';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-playfair',
});

export const metadata: Metadata = {
  title: 'Vaidya',
  description: 'AI receptionist platform for clinics',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no" className={`h-full ${playfair.variable}`}>
      <body className="h-full font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
