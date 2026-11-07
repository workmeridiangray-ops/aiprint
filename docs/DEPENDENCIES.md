# Dependencies and licences

Generated from package-lock.json and each package's own package.json. This is an inventory, not legal advice;
licence terms must be reviewed by the client's counsel before commercial hand-over.

## Direct dependencies
| Package | Version | Licence | Used in |
|---|---|---|---|
| @aws-sdk/client-s3 | 3.1164.0 | Apache-2.0 | runtime |
| @types/node | 26.6.6 | MIT | dev |
| @types/nodemailer | 8.0.2 | MIT | dev |
| @types/pg | 8.23.1 | MIT | dev |
| @types/qrcode | 1.5.6 | MIT | dev |
| @types/react | 19.3.0 | MIT | dev |
| @types/react-dom | 19.3.0 | MIT | dev |
| @types/smtp-server | 3.5.13 | MIT | dev |
| ioredis | 6.0.0 | MIT | runtime |
| next | 15.5.29 | MIT | runtime |
| nodemailer | 10.3.1 | MIT-0 | runtime |
| pdf-lib | 1.17.1 | MIT | runtime |
| pg | 8.23.1 | MIT | runtime |
| qrcode | 1.5.4 | MIT | runtime |
| react | 19.3.1 | MIT | runtime |
| react-dom | 19.3.1 | MIT | runtime |
| s3rver | 3.7.1 | MIT | dev |
| sharp | 0.35.5 | Apache-2.0 | runtime |
| smtp-server | 3.21.3 | MIT-0 | dev |
| tsx | 4.23.15 | MIT | runtime |
| typescript | 5.9.3 | Apache-2.0 | dev |
| vitest | 5.1.0 | MIT | dev |
| zod | 4.6.7 | MIT | runtime |

## Licence counts (all 345 installed packages)
- MIT: 250
- Apache-2.0: 43
- ISC: 14
- MPL-2.0: 12
- LGPL-3.0-or-later: 10
- UNKNOWN: 5
- Apache-2.0 AND LGPL-3.0-or-later: 3
- MIT-0: 2
- 0BSD: 2
- Apache-2.0 AND LGPL-3.0-or-later AND MIT: 1
- CC-BY-4.0: 1
- (MIT AND Zlib): 1
- BSD-3-Clause: 1

## Needs a human licence review (copyleft, weak copyleft, unknown)
| Package | Version | Licence | Used in |
|---|---|---|---|
| @img/sharp-libvips-darwin-arm64 | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-darwin-x64 | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-arm | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-arm64 | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-ppc64 | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-riscv64 | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-s390x | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-x64 | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.4 | LGPL-3.0-or-later | runtime |
| @img/sharp-wasm32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | runtime |
| @img/sharp-win32-arm64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | runtime |
| @img/sharp-win32-ia32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | runtime |
| @img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | runtime |
| busboy | 0.3.1 | UNKNOWN | dev |
| caniuse-lite | 1.0.30001823 | CC-BY-4.0 | runtime |
| dicer | 0.3.0 | UNKNOWN | dev |
| humanize-number | 0.0.2 | UNKNOWN | dev |
| lightningcss | 1.33.0 | MPL-2.0 | dev |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | dev |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | dev |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | dev |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | dev |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | dev |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | dev |
| only | 0.0.2 | UNKNOWN | dev |
| streamsearch | 0.1.2 | UNKNOWN | dev |

Not in the npm inventory (installed in the Docker image or bundled as files):

| Item | Licence / status | Used for |
|---|---|---|
| opencv-contrib-python-headless 4.10.0.84 (pip) | Apache-2.0 per its package metadata; not verified against upstream | image enhancement (dnn_superres) |
| numpy (pip) | BSD-3-Clause per package metadata; not verified | dependency of OpenCV |
| ESPCN_x2.pb, ESPCN_x4.pb (assets/models) | origin: supplied inside the PrintForge Preflight MVP; the licence of the trained model files has NOT been verified | enhancement models |
| FOGRA39.icc (assets/profiles) | the file says "free of known copyright restrictions"; not legally reviewed; client has not confirmed FOGRA39 | CMYK export |
| DejaVu Sans (Debian fonts-dejavu-core) | free font licence (Bitstream Vera / public domain changes) per Debian; not verified | watermark text |
| python3 | PSF licence | runs the enhancement script |

Ghostscript is NOT used (CMYK is done with libvips/lcms and our own file writers), so its AGPL terms do not apply.

Notes: sharp bundles libvips as a separate native package (licence shown above if LGPL); it is dynamically linked, but
the client should confirm this satisfies their distribution model. Licence fields come from package metadata and were
not verified against upstream licence files.
