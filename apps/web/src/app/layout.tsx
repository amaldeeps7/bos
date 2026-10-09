import type { Metadata, Viewport } from 'next';
import 'lucide-static/font/lucide.css';
import './globals.css';

export const metadata: Metadata = { title: 'Business OS', description: 'Customers, projects, tasks, billing and approvals in one place.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
