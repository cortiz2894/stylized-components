import type { Metadata } from "next";
import { bebasNeue, barlowCondensed, ibmPlexMono } from "@/components/shared/fonts";
import "./globals.css";
import Footer from "@/components/overlay/Footer";


export const metadata: Metadata = {
  title: "Stylized Components — by Cortiz",
  description:
    "A collection of real-time, anime-inspired rendering systems for the web, built with React Three Fiber and custom GLSL.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${bebasNeue.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable} antialiased`}
      >
        {children}
        <Footer />
      </body>
    </html>
  );
}
