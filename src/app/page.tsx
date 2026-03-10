"use client";

import dynamic from "next/dynamic";

const SchedulerApp = dynamic(
  () => import("@/components/scheduler-app").then((mod) => mod.SchedulerApp),
  {
    ssr: false,
    loading: () => (
      <main className="min-h-screen bg-[var(--page-background)] px-6 py-8 text-[var(--foreground)]">
        <div className="mx-auto max-w-7xl animate-pulse rounded-[2rem] border border-white/60 bg-white/70 p-8 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="h-8 w-72 rounded-full bg-slate-200" />
          <div className="mt-4 h-4 w-40 rounded-full bg-slate-200" />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-28 rounded-[1.5rem] bg-slate-100"
              />
            ))}
          </div>
        </div>
      </main>
    ),
  },
);

export default function Home() {
  return <SchedulerApp />;
}
