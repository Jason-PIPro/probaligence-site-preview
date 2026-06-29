# Self-hosted fonts

Self-hosted on purpose. This is a German site with a consent banner, so the fonts are not
hotlinked from Google Fonts or any third-party CDN (hotlinking Google Fonts has been ruled a
GDPR problem in Germany). All three families are SIL Open Font License 1.1, which permits
redistribution and self-hosting.

The refined-dark-instrument design pairing (2026-06-18):

- Space Grotesk (display): characterful technical grotesque for headlines. OFL 1.1.
- IBM Plex Sans (body and UI): engineered, readable humanist sans. OFL 1.1.
- IBM Plex Mono (data, numbers, eyebrows, labels): the instrument-readout signal. OFL 1.1.

Files (latin subset, woff2), fetched from the Fontsource mirror (cdn.jsdelivr.net/fontsource):

- space-grotesk-700.woff2, space-grotesk-500.woff2
- ibm-plex-sans-400.woff2, ibm-plex-sans-500.woff2, ibm-plex-sans-600.woff2
- ibm-plex-mono-400.woff2, ibm-plex-mono-500.woff2

If Jason's brand guide later locks different typefaces, swap the files here and update the
@font-face blocks at the top of ../style.css. The fallback stacks in the CSS keep the layout
intact if a file is ever missing.
