import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bantai — test case agents",
  description:
    "Upload requirement documents and let a roster of specialist agents write the test suite.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
