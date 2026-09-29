import type { Metadata } from "next";
import { Fraunces, Source_Sans_3, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SettingsProvider } from "@/context/SettingsProvider";
import { SkipLink } from "@/components/a11y/SkipLink";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const body = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ajedrez accesible B8 · ONCE",
  description:
    "Tablero de ajedrez accesible con notación Braille Unicode B8 (Comisión Braille Española / ONCE) y descripción audio para lectores de pantalla.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SettingsProvider>
          <SkipLink targetId="contenido" />
          {children}
        </SettingsProvider>
      </body>
    </html>
  );
}
