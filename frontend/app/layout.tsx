import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeToggle } from "@/components/theme-toggle";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Epidemic Policy Visualizer",
  description: "Interactive MDP policy visualization for epidemic interventions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
              try {
                const saved = localStorage.getItem('theme');
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                const dark = saved ? saved === 'dark' : prefersDark;
                document.documentElement.classList.toggle('dark', dark);
              } catch (_) {}
            })();`,
          }}
        />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} min-h-screen antialiased`}
      >
        <div className="relative min-h-screen overflow-x-hidden bg-app text-app-fg transition-colors duration-300">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(35,73,122,0.18),transparent_35%),radial-gradient(circle_at_82%_75%,rgba(22,130,111,0.18),transparent_32%)] dark:bg-[radial-gradient(circle_at_15%_20%,rgba(76,138,219,0.22),transparent_38%),radial-gradient(circle_at_82%_75%,rgba(63,204,179,0.2),transparent_35%)]" />
          <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
            <h1 className="text-sm font-semibold tracking-[0.2em] uppercase text-app-muted">
              Epidemic Policy Lab
            </h1>
            <ThemeToggle />
          </header>
          <main className="relative mx-auto w-full max-w-6xl px-6 pb-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
