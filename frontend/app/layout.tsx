import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Epidemic Drift Lab",
  description: "Minimal epidemic policy sandbox with connected-field spread dynamics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="relative min-h-screen overflow-x-hidden text-app-fg transition-colors duration-300">
          <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
            <div>
              <h1 className="text-sm font-semibold tracking-[0.2em] uppercase text-app-muted">
                Epidemic Drift Lab
              </h1>
              <p className="text-xs text-app-muted">Policy design and spread-flow simulation</p>
            </div>
          </header>
          <main className="relative mx-auto w-full max-w-6xl px-4 pb-8 md:px-6">{children}</main>
          <footer className="mx-auto w-full max-w-6xl px-4 pb-6 text-[11px] leading-relaxed text-app-muted md:px-6">
            Methodology and Literature Review by Maitreya Sameer Ganu, Cross-validation and
            parameterisation by Pranav M., Frontend and Model Architecture by Ashin Vinod.
          </footer>
        </div>
      </body>
    </html>
  );
}
