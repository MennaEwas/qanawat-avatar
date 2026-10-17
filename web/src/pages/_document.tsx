import Document, { Html, Head, Main, NextScript } from "next/document";

export default class AppDocument extends Document {
  render() {
    // Render the screen's dark/light theme into the HTML itself, so a light
    // screen doesn't flash dark before the page's JS runs (HomeInner keeps it
    // in sync on the client).
    const pageProps = this.props.__NEXT_DATA__?.props?.pageProps as
      | { screen?: { theme?: string } }
      | undefined;
    const theme = pageProps?.screen?.theme === "light" ? "light" : "dark";
    return (
      <Html lang="en" data-theme={theme}>
        <Head>
          {/* Arabic fonts offered by the chat's font picker (ChatTile). */}
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600&family=Tajawal:wght@400;700&family=Noto+Kufi+Arabic:wght@400;600&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap"
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
