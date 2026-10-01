# stb (vendored)

Two single-file libraries by Sean Barrett, from https://github.com/nothings/stb
(branch `master`, commit `2c980bb59875b0d32144a71867fbdebb2f77cd20`, fetched
2026-09-30), unchanged:

| File | Version | Used for |
| --- | --- | --- |
| `stb_truetype.h` | v1.26 | TrueType parsing: cmap, advance widths (`hmtx`), kerning (`kern` and GPOS pair adjustment), vertical metrics (`hhea`) |
| `stb_image.h` | v2.30 | Only its zlib decoder (`STBI_SUPPORT_ZLIB` with every image format off) to inflate the gzip-compressed embedded fonts |

Both are compiled in one translation unit,
`src/platform/portable/StbImpl.cpp`, by the portable text layout
(`FANTOM_TEXT_LAYOUT=portable`, see `native/README.md`).

License: each file ends with its license text. They are dual licensed, MIT
(Copyright (c) 2017 Sean Barrett) or public domain (Unlicense), at the
user's choice.
