# Roboto 2.138

The Android system font, embedded into the host executable so that `@expo/ui`
Jetpack Compose text (and `fontFamily: "Roboto"` in React Native text) is
measured with Android's font without external files.

- Source: <https://github.com/googlefonts/roboto-2/releases/download/v2.138/roboto-unhinted.zip>
  (the same release `native/tools/compose-ref/fetch-fonts.sh` downloads).
- License: Apache 2.0 ([`LICENSE`](LICENSE), from the same archive).
- Faces: Regular (400), Medium (500), Bold (700), Italic (400 italic). Other
  weights resolve to the nearest of these (see
  `native/overlay/tester/src/components/FantomComposeText.mm`).

SHA-256:

```
f3edb8058e523f5612bfd99d0745e661568ad85e1b6217bc62f786fabae624c6  Roboto-Regular.ttf
b398bb9c791ddb08f1063d9c874f98e8aadb99132043b2d272a9276cf90c465a  Roboto-Medium.ttf
2ca2b3bfc2c2d43fa8f2b7227982d735fd537ecf113a4c56cc2d292bcc3106c8  Roboto-Bold.ttf
2b4076dd3f5a7fadfca760ef45557a0d437af983284652fc149535c5bd93d493  Roboto-Italic.ttf
```

The build (`native/overlay/tester/cmake/embed-files.cmake`) gzips each file and
generates a C++ source with the bytes; `EmbeddedFonts.mm` inflates them at
startup and registers them for the process.
