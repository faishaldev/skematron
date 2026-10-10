import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skematron (local)",
  description:
    "Local, read-only schema viewer: browse, export, snapshot and compare PostgreSQL schemas.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Skematron
          </Link>
          <span className="tag">local schema viewer · read-only</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
