import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import Nav from "@/components/layout/Nav";
import Footer from "@/components/layout/Footer";
import Providers from "@/components/layout/Providers";

const GA_ID = "G-K86TBF328F";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cambridge TCG — Japanese Trading Cards",
  description: "Premium Japanese One Piece, Pokémon and Dragon Ball TCG cards. Authentic, sourced direct from Japan.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://cambridgetcg.com"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}
      </Script>
      <body className={inter.className}>
        <Providers>
          <Nav />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
