import type { Metadata, Viewport } from 'next';

import { AuthProvider } from '@/components/auth/AuthProvider';

import './globals.css';

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
    <html lang="en" className="h-full">
      <body className="h-full font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
