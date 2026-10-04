import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HCS Trace Lab",
  description: "HCS-10 topic inspector for Scaffold-HBAR"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
