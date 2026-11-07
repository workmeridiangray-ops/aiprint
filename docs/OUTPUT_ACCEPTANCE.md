# Output acceptance record

Generated 2026-11-07T13:06:50.867Z by `npx tsx scripts/docs/acceptance.ts`.

**Scope and limits (read first)**
- Source image is a **synthetic** 1800x1200 test picture generated in the script. It is not client artwork and nothing here is client-approved.
- Each row renders through the real export engine, then re-measures the file with sharp / pdf-lib separately from the engine's own validator.
- Colour: sRGB only. **CMYK is not produced or tested** (needs a client-supplied profile and sample artwork).
- Not tested here: print-shop colour accuracy, printed trim accuracy, PDF/X compliance (the PDF sets Bleed and Trim boxes only and does not claim PDF/X), preview-versus-export pixel parity.
- Bleed is mirrored real pixels, no generated content.
- Sizes over 80 megapixels including bleed are refused by design; those rows show the expected refusal.

Result: 60 passed, 0 failed.

| Size | Format | DPI | Bleed mm | Measured | Density | SHA-256 (12) | Result |
|---|---|---|---|---|---|---|---|
| Business card 90x54 | png | 300 | 0 | 1063x638 px | 300 | dc0e7570c7df | pass (49444 B, 64 ms) |
| Business card 90x54 | png | 300 | 3 | 1134x709 px | 300 | 771443d142c3 | pass (55026 B, 72 ms) |
| Business card 90x54 | png | 150 | 3 | 567x354 px | 150 | 0f6a6ef6cfd3 | pass (16506 B, 34 ms) |
| Business card 90x54 | jpg | 300 | 0 | 1063x638 px | 300 | 181d67e02e5d | pass (25279 B, 63 ms) |
| Business card 90x54 | jpg | 300 | 3 | 1134x709 px | 300 | dc9d89910264 | pass (28077 B, 73 ms) |
| Business card 90x54 | jpg | 150 | 3 | 567x354 px | 150 | 14cb00ea112c | pass (12694 B, 35 ms) |
| Business card 90x54 | tiff | 300 | 0 | 1063x638 px | 300 | 741b81e46d89 | pass (44346 B, 70 ms) |
| Business card 90x54 | tiff | 300 | 3 | 1134x709 px | 300 | b82264809c4c | pass (47720 B, 79 ms) |
| Business card 90x54 | tiff | 150 | 3 | 567x354 px | 150 | 3804cbe7e2b1 | pass (17048 B, 39 ms) |
| Business card 90x54 | pdf | 300 | 0 | 90.0x54.0 mm page, trim 90.0x54.0 mm | - | 9b924ccd15bb | pass (42289 B, 171 ms) |
| Business card 90x54 | pdf | 300 | 3 | 96.0x60.0 mm page, trim 90.0x54.0 mm | - | 8a12247031f4 | pass (45784 B, 116 ms) |
| Business card 90x54 | pdf | 150 | 3 | 96.0x60.0 mm page, trim 90.0x54.0 mm | - | 24818aec923c | pass (14825 B, 79 ms) |
| A6 105x148 | png | 300 | 0 | 1240x1748 px | 300 | ef36a7ee9c18 | pass (132232 B, 244 ms) |
| A6 105x148 | png | 300 | 3 | 1311x1819 px | 300 | 23d20fc67e8a | pass (137701 B, 266 ms) |
| A6 105x148 | png | 150 | 3 | 656x909 px | 150 | daaaeef90a55 | pass (41469 B, 72 ms) |
| A6 105x148 | jpg | 300 | 0 | 1240x1748 px | 300 | 711f3e6e381c | pass (52066 B, 230 ms) |
| A6 105x148 | jpg | 300 | 3 | 1311x1819 px | 300 | 8c9c9fb1b6d9 | pass (57244 B, 284 ms) |
| A6 105x148 | jpg | 150 | 3 | 656x909 px | 150 | be791855c647 | pass (20468 B, 78 ms) |
| A6 105x148 | tiff | 300 | 0 | 1240x1748 px | 300 | 4655c2f0c81b | pass (108486 B, 344 ms) |
| A6 105x148 | tiff | 300 | 3 | 1311x1819 px | 300 | 7356b75d6032 | pass (111032 B, 324 ms) |
| A6 105x148 | tiff | 150 | 3 | 656x909 px | 150 | f17d7682e34e | pass (36496 B, 73 ms) |
| A6 105x148 | pdf | 300 | 0 | 105.0x148.0 mm page, trim 105.0x148.0 mm | - | 69973a8eaeb8 | pass (109605 B, 346 ms) |
| A6 105x148 | pdf | 300 | 3 | 111.0x154.0 mm page, trim 105.0x148.0 mm | - | 3e04dc113fdb | pass (111851 B, 492 ms) |
| A6 105x148 | pdf | 150 | 3 | 111.0x154.0 mm page, trim 105.0x148.0 mm | - | 31cd0558615a | pass (35657 B, 108 ms) |
| A4 210x297 | png | 300 | 0 | 2480x3508 px | 300 | 862313aad663 | pass (432321 B, 887 ms) |
| A4 210x297 | png | 300 | 3 | 2551x3579 px | 300 | 98403a171123 | pass (440931 B, 898 ms) |
| A4 210x297 | png | 150 | 3 | 1276x1789 px | 150 | 31eca321742c | pass (135504 B, 294 ms) |
| A4 210x297 | jpg | 300 | 0 | 2480x3508 px | 300 | dd86a1939b84 | pass (168717 B, 891 ms) |
| A4 210x297 | jpg | 300 | 3 | 2551x3579 px | 300 | 22b1c2c828a8 | pass (171354 B, 918 ms) |
| A4 210x297 | jpg | 150 | 3 | 1276x1789 px | 150 | b0a6522f41d5 | pass (55209 B, 251 ms) |
| A4 210x297 | tiff | 300 | 0 | 2480x3508 px | 300 | ba6018ac6463 | pass (323464 B, 998 ms) |
| A4 210x297 | tiff | 300 | 3 | 2551x3579 px | 300 | 2409bc69b957 | pass (326328 B, 1001 ms) |
| A4 210x297 | tiff | 150 | 3 | 1276x1789 px | 150 | 853ee59f5715 | pass (109870 B, 290 ms) |
| A4 210x297 | pdf | 300 | 0 | 210.0x297.0 mm page, trim 210.0x297.0 mm | - | f95713fcd5d7 | pass (333228 B, 1300 ms) |
| A4 210x297 | pdf | 300 | 3 | 216.0x303.0 mm page, trim 210.0x297.0 mm | - | 1a3d16b7ac63 | pass (337950 B, 1307 ms) |
| A4 210x297 | pdf | 150 | 3 | 216.0x303.0 mm page, trim 210.0x297.0 mm | - | cf6eb94c3de6 | pass (111304 B, 408 ms) |
| A3 297x420 | png | 300 | 0 | 3508x4961 px | 300 | 0fffc8964b5f | pass (770826 B, 1855 ms) |
| A3 297x420 | png | 300 | 3 | 3579x5031 px | 300 | 3ad22ded6e70 | pass (778282 B, 1968 ms) |
| A3 297x420 | png | 150 | 3 | 1789x2516 px | 150 | 0e37f9eb7fbb | pass (244655 B, 569 ms) |
| A3 297x420 | jpg | 300 | 0 | 3508x4961 px | 300 | 4c68f81256e8 | pass (307487 B, 1665 ms) |
| A3 297x420 | jpg | 300 | 3 | 3579x5031 px | 300 | 3de910b11904 | pass (315888 B, 1737 ms) |
| A3 297x420 | jpg | 150 | 3 | 1789x2516 px | 150 | 45ff280decd2 | pass (95607 B, 449 ms) |
| A3 297x420 | tiff | 300 | 0 | 3508x4961 px | 300 | 9ad937e3e8d5 | pass (539844 B, 1939 ms) |
| A3 297x420 | tiff | 300 | 3 | 3579x5031 px | 300 | fb89de3ffe22 | pass (543966 B, 1921 ms) |
| A3 297x420 | tiff | 150 | 3 | 1789x2516 px | 150 | b2682b6e37bc | pass (182392 B, 544 ms) |
| A3 297x420 | pdf | 300 | 0 | 297.0x420.0 mm page, trim 297.0x420.0 mm | - | 18caf80f812d | pass (570350 B, 2428 ms) |
| A3 297x420 | pdf | 300 | 3 | 303.0x426.0 mm page, trim 297.0x420.0 mm | - | 0caf3965ed9b | pass (573678 B, 2766 ms) |
| A3 297x420 | pdf | 150 | 3 | 303.0x426.0 mm page, trim 297.0x420.0 mm | - | 1fe4af0150f9 | pass (194697 B, 722 ms) |
| Poster 500x500 | png | 300 | 0 | 5906x5906 px | 300 | ea9c46db82df | pass (1566930 B, 2787 ms) |
| Poster 500x500 | png | 300 | 3 | 5976x5976 px | 300 | 6638e68abe0e | pass (1572940 B, 3393 ms) |
| Poster 500x500 | png | 150 | 3 | 2988x2988 px | 150 | e619fd3f6d73 | pass (456155 B, 761 ms) |
| Poster 500x500 | jpg | 300 | 0 | 5906x5906 px | 300 | e0afbfb81cff | pass (586618 B, 2916 ms) |
| Poster 500x500 | jpg | 300 | 3 | 5976x5976 px | 300 | f7a67ec9e017 | pass (597983 B, 2872 ms) |
| Poster 500x500 | jpg | 150 | 3 | 2988x2988 px | 150 | ab911f57adaa | pass (175109 B, 732 ms) |
| Poster 500x500 | tiff | 300 | 0 | 5906x5906 px | 300 | 8e3dabbe7d54 | pass (992324 B, 2954 ms) |
| Poster 500x500 | tiff | 300 | 3 | 5976x5976 px | 300 | 73bbda74c2f7 | pass (1008522 B, 3193 ms) |
| Poster 500x500 | tiff | 150 | 3 | 2988x2988 px | 150 | 2ed1aff4d9a7 | pass (331070 B, 796 ms) |
| Poster 500x500 | pdf | 300 | 0 | 500.0x500.0 mm page, trim 500.0x500.0 mm | - | 2015df013df2 | pass (1031364 B, 4034 ms) |
| Poster 500x500 | pdf | 300 | 3 | 506.0x506.0 mm page, trim 500.0x500.0 mm | - | 9f73682ed3af | pass (1044835 B, 4265 ms) |
| Poster 500x500 | pdf | 150 | 3 | 506.0x506.0 mm page, trim 500.0x500.0 mm | - | 0c1e4681996c | pass (354834 B, 1100 ms) |
