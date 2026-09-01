<?xml version="1.0" encoding="UTF-8"?>
<!--
  Browser view for /feed.xml.

  An RSS feed is machine-readable XML, so a browser shows it as raw markup. This
  stylesheet is applied client-side, by the browser only, when a person opens the
  feed URL directly. Feed readers ignore the xml-stylesheet processing
  instruction entirely and keep parsing the RSS, so nothing about the feed's
  behaviour changes.

  Written 2026-09-01, Jason's call, after /feed.xml went live and read as code.

  Constraints this file has to keep:
  - No JavaScript, no external resources. The site CSP is
    "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'",
    so the inline style block and the same-origin fonts below are allowed and
    anything hosted elsewhere is not.
  - XSLT 1.0. That is what browsers implement, and nothing newer will run.
  - Brand tokens copied from probaligence-site-final/site.css. If those change,
    change them here too: this file cannot import the site stylesheet, because
    the transform output is a standalone document.
  - The row layout follows design-toolbox/toolbox/redesign-news-editorial.html
    (mono date, hairline rows, amber on hover), without its filter pills and
    scroll reveals. A feed view is a list a person lands on once, so the motion
    system that carries a real page would be noise here.
-->
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:atom="http://www.w3.org/2005/Atom"
                exclude-result-prefixes="atom">

  <xsl:output method="html" encoding="UTF-8" indent="yes"
              doctype-system="about:legacy-compat"/>

  <xsl:template match="/rss/channel">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="title"/> | RSS feed</title>
        <meta name="robots" content="noindex, follow"/>
        <link rel="icon" href="/probaligence-site-preview/assets/favicon.ico"/>
        <style>
          @font-face{font-family:'Space Grotesk';src:url('/probaligence-site-preview/assets/fonts/space-grotesk-700.woff2') format('woff2');font-weight:700;font-display:swap}
          @font-face{font-family:'IBM Plex Sans';src:url('/probaligence-site-preview/assets/fonts/ibm-plex-sans-400.woff2') format('woff2');font-weight:400;font-display:swap}
          @font-face{font-family:'IBM Plex Mono';src:url('/probaligence-site-preview/assets/fonts/ibm-plex-mono-400.woff2') format('woff2');font-weight:400;font-display:swap}

          :root{
            --bg:#060607; --surface:#101012;
            --hairline:rgba(255,255,255,.09); --text:#F4F3EF; --muted:#9C9C96;
            --faint:#82827C; --amber:#FFB006;
          }
          *{box-sizing:border-box}
          body{margin:0;background:var(--bg);color:var(--text);
            font-family:'IBM Plex Sans',system-ui,-apple-system,Segoe UI,sans-serif;
            font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
          .wrap{max-width:880px;margin:0 auto;padding:64px 24px 96px}
          a{color:inherit}

          .eyebrow{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;
            letter-spacing:.18em;text-transform:uppercase;color:var(--amber);margin:0 0 14px}
          h1{font-family:'Space Grotesk',system-ui,sans-serif;font-weight:700;
            font-size:clamp(30px,5vw,44px);line-height:1.1;margin:0 0 16px}
          .lede{color:var(--muted);margin:0 0 32px;max-width:60ch}

          .note{background:var(--surface);border:1px solid var(--hairline);
            border-left:2px solid var(--amber);padding:20px 22px;margin:0 0 44px}
          .note p{margin:0 0 12px}
          .note p:last-child{margin:0}
          .addr{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:14px;
            color:var(--amber);word-break:break-all;-webkit-user-select:all;user-select:all}

          .count{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;
            letter-spacing:.18em;text-transform:uppercase;color:var(--faint);
            padding-bottom:12px;border-bottom:1px solid var(--hairline);margin:0}

          .row{display:block;text-decoration:none;padding:22px 0 20px;
            border-bottom:1px solid var(--hairline);
            transition:padding-left .25s cubic-bezier(.16,.84,.32,1),
                       border-color .25s}
          .row:hover,.row:focus-visible{padding-left:12px;border-color:rgba(255,176,6,.35)}
          .row:focus-visible{outline:2px solid var(--amber);outline-offset:4px}
          .date{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;
            letter-spacing:.1em;color:var(--faint);display:block;margin-bottom:8px}
          .title{font-family:'Space Grotesk',system-ui,sans-serif;font-weight:700;
            font-size:19px;line-height:1.3;display:block;margin-bottom:8px;
            transition:color .25s}
          .row:hover .title,.row:focus-visible .title{color:var(--amber)}
          .desc{color:var(--muted);font-size:15px;display:block;max-width:72ch}

          .foot{margin-top:48px;padding-top:24px;border-top:1px solid var(--hairline);
            font-size:14px;color:var(--faint)}
          .foot a{color:var(--amber);text-decoration:none;margin-right:24px}
          .foot a:hover{text-decoration:underline}

          @media (prefers-reduced-motion:reduce){
            .row,.title{transition:none}
            .row:hover,.row:focus-visible{padding-left:0}
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <p class="eyebrow">RSS feed</p>
          <h1><xsl:value-of select="title"/></h1>
          <p class="lede"><xsl:value-of select="description"/></p>

          <div class="note">
            <p>You are looking at this site's RSS feed. It is a machine-readable
               list of every article, meant for feed readers rather than for
               reading here.</p>
            <p>To follow new articles automatically, paste this address into a
               feed reader:</p>
            <p class="addr"><xsl:value-of select="atom:link/@href"/></p>
            <p>To read the articles in a browser, go to
               <a href="{link}">News and Guides</a>.</p>
          </div>

          <p class="count"><xsl:value-of select="count(item)"/> articles</p>

          <xsl:for-each select="item">
            <a class="row" href="{link}">
              <span class="date"><xsl:value-of select="substring(pubDate, 6, 11)"/></span>
              <span class="title"><xsl:value-of select="title"/></span>
              <span class="desc"><xsl:value-of select="description"/></span>
            </a>
          </xsl:for-each>

          <p class="foot">
            <a href="/probaligence-site-preview/">probaligence.com</a>
            <xsl:text> </xsl:text>
            <a href="{link}">News and Guides</a>
          </p>
        </div>
      </body>
    </html>
  </xsl:template>

</xsl:stylesheet>
