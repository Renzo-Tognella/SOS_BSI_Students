import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";

import "./globals.css";
import { Providers } from "@/app/providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"]
});

export const metadata: Metadata = {
  title: "Roadmap Acadêmico SI UTFPR",
  description: "Roadmap acadêmico para SI UTFPR Curitiba com parser de histórico, progresso por matriz e montagem de grade."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} ${ibmPlexMono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
