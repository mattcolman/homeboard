'use client';
import Link from 'next/link';
import { ArrowLeft, Images } from 'lucide-react';
import { SiteNav } from '../components/SiteNav';
import '../calendar/calendar.css';

export default function PhotosPage() {
  return (
    <main className="calendar-shell">
      <header className="calendar-header">
        <Link href="/" className="calendar-brand">
          <ArrowLeft />
          <span>
            <Images />
          </span>
          <div>
            Photos<small>Family slideshow</small>
          </div>
        </Link>
        <SiteNav />
      </header>
      <div className="calendar-unconnected">
        <Images />
        <h1>No photo source yet.</h1>
        <p>
          This screen will play a full-screen family slideshow. A Google
          Photos connection is on the roadmap — it needs a Google account
          link, which hasn’t been set up yet.
        </p>
        <Link href="/connections">View connections</Link>
      </div>
    </main>
  );
}
