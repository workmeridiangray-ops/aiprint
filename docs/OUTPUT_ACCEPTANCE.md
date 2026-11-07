# Output acceptance record

Generated 2026-11-07T20:45:13.160Z by `npx tsx scripts/docs/acceptance.ts`.

**Scope and limits (read first)**
- Source image is a **synthetic** 1800x1200 test picture generated in the script. It is not client artwork and nothing here is client-approved.
- Each row renders through the real export engine, then re-measures the file with sharp / pdf-lib separately from the engine's own validator.
- Colour: RGB rows are sRGB. CMYK rows (TIFF and PDF) use the bundled FOGRA39 profile with a 300% total-ink limit; they are checked for size, colour model, embedded profile and maximum ink only. The client has not confirmed the profile or supplied sample artwork, so **colour accuracy against a real press is not tested**.
- Not tested here: print-shop colour accuracy, printed trim accuracy, PDF/X compliance (the PDF sets Bleed and Trim boxes only and does not claim PDF/X; the quotation excludes it), preview-versus-export pixel parity.
- Bleed is mirrored real pixels, no generated content.
- Sizes over 80 megapixels including bleed are refused by design; those rows show the expected refusal.

Result: 90 passed, 0 failed.

| Size | Format | DPI | Bleed mm | Measured | Density | SHA-256 (12) | Result |
|---|---|---|---|---|---|---|---|
| Business card 90x54 | png rgb | 300 | 0 | 1063x638 px | 300 | dc0e7570c7df | pass (49444 B, 112 ms) |
| Business card 90x54 | png rgb | 300 | 3 | 1134x709 px | 300 | 771443d142c3 | pass (55026 B, 126 ms) |
| Business card 90x54 | png rgb | 150 | 3 | 567x354 px | 150 | 0f6a6ef6cfd3 | pass (16506 B, 66 ms) |
| Business card 90x54 | jpg rgb | 300 | 0 | 1063x638 px | 300 | 181d67e02e5d | pass (25279 B, 101 ms) |
| Business card 90x54 | jpg rgb | 300 | 3 | 1134x709 px | 300 | dc9d89910264 | pass (28077 B, 128 ms) |
| Business card 90x54 | jpg rgb | 150 | 3 | 567x354 px | 150 | 14cb00ea112c | pass (12694 B, 64 ms) |
| Business card 90x54 | tiff rgb | 300 | 0 | 1063x638 px | 300 | 741b81e46d89 | pass (44346 B, 128 ms) |
| Business card 90x54 | tiff rgb | 300 | 3 | 1134x709 px | 300 | b82264809c4c | pass (47720 B, 142 ms) |
| Business card 90x54 | tiff rgb | 150 | 3 | 567x354 px | 150 | 3804cbe7e2b1 | pass (17048 B, 61 ms) |
| Business card 90x54 | pdf rgb | 300 | 0 | 90.0x54.0 mm page, trim 90.0x54.0 mm | - | 80a100cb8d21 | pass (42290 B, 236 ms) |
| Business card 90x54 | pdf rgb | 300 | 3 | 96.0x60.0 mm page, trim 90.0x54.0 mm | - | 0a709d136ee8 | pass (45784 B, 217 ms) |
| Business card 90x54 | pdf rgb | 150 | 3 | 96.0x60.0 mm page, trim 90.0x54.0 mm | - | 5764165dd34e | pass (14825 B, 96 ms) |
| Business card 90x54 | tiff cmyk | 300 | 0 | 1063x638 px CMYK, max ink 182% | 300 | cfd509d1c9ca | pass (174532 B, 372 ms) |
| Business card 90x54 | tiff cmyk | 300 | 3 | 1134x709 px CMYK, max ink 183% | 300 | 948384c101ff | pass (179534 B, 358 ms) |
| Business card 90x54 | tiff cmyk | 150 | 3 | 567x354 px CMYK, max ink 171% | 150 | 275d938f92a0 | pass (139710 B, 137 ms) |
| Business card 90x54 | pdf cmyk | 300 | 0 | 90.0x54.0 mm page, trim 90.0x54.0 mm, CMYK ICC 1063x638, max ink 182% | - | bb107c027e54 | pass (149760 B, 368 ms) |
| Business card 90x54 | pdf cmyk | 300 | 3 | 96.0x60.0 mm page, trim 90.0x54.0 mm, CMYK ICC 1134x709, max ink 183% | - | 06d70b38b70c | pass (154449 B, 471 ms) |
| Business card 90x54 | pdf cmyk | 150 | 3 | 96.0x60.0 mm page, trim 90.0x54.0 mm, CMYK ICC 567x354, max ink 171% | - | 54777e3d71d6 | pass (114081 B, 211 ms) |
| A6 105x148 | png rgb | 300 | 0 | 1240x1748 px | 300 | ef36a7ee9c18 | pass (132232 B, 322 ms) |
| A6 105x148 | png rgb | 300 | 3 | 1311x1819 px | 300 | 23d20fc67e8a | pass (137701 B, 333 ms) |
| A6 105x148 | png rgb | 150 | 3 | 656x909 px | 150 | daaaeef90a55 | pass (41469 B, 97 ms) |
| A6 105x148 | jpg rgb | 300 | 0 | 1240x1748 px | 300 | 711f3e6e381c | pass (52066 B, 340 ms) |
| A6 105x148 | jpg rgb | 300 | 3 | 1311x1819 px | 300 | 8c9c9fb1b6d9 | pass (57244 B, 389 ms) |
| A6 105x148 | jpg rgb | 150 | 3 | 656x909 px | 150 | be791855c647 | pass (20468 B, 101 ms) |
| A6 105x148 | tiff rgb | 300 | 0 | 1240x1748 px | 300 | 4655c2f0c81b | pass (108486 B, 306 ms) |
| A6 105x148 | tiff rgb | 300 | 3 | 1311x1819 px | 300 | 7356b75d6032 | pass (111032 B, 406 ms) |
| A6 105x148 | tiff rgb | 150 | 3 | 656x909 px | 150 | f17d7682e34e | pass (36496 B, 135 ms) |
| A6 105x148 | pdf rgb | 300 | 0 | 105.0x148.0 mm page, trim 105.0x148.0 mm | - | bac0c18cb4f2 | pass (109604 B, 478 ms) |
| A6 105x148 | pdf rgb | 300 | 3 | 111.0x154.0 mm page, trim 105.0x148.0 mm | - | c2e0c314aa77 | pass (111850 B, 538 ms) |
| A6 105x148 | pdf rgb | 150 | 3 | 111.0x154.0 mm page, trim 105.0x148.0 mm | - | 95a75bda0994 | pass (35656 B, 171 ms) |
| A6 105x148 | tiff cmyk | 300 | 0 | 1240x1748 px CMYK, max ink 193% | 300 | 15354e35c773 | pass (263270 B, 984 ms) |
| A6 105x148 | tiff cmyk | 300 | 3 | 1311x1819 px CMYK, max ink 195% | 300 | 594eb1db8fff | pass (267226 B, 1140 ms) |
| A6 105x148 | tiff cmyk | 150 | 3 | 656x909 px CMYK, max ink 186% | 150 | cbabfc5d5b31 | pass (165842 B, 321 ms) |
| A6 105x148 | pdf cmyk | 300 | 0 | 105.0x148.0 mm page, trim 105.0x148.0 mm, CMYK ICC 1240x1748, max ink 193% | - | 9fcfb4ccc103 | pass (235480 B, 1196 ms) |
| A6 105x148 | pdf cmyk | 300 | 3 | 111.0x154.0 mm page, trim 105.0x148.0 mm, CMYK ICC 1311x1819, max ink 195% | - | 96a6f01f7c77 | pass (238985 B, 1216 ms) |
| A6 105x148 | pdf cmyk | 150 | 3 | 111.0x154.0 mm page, trim 105.0x148.0 mm, CMYK ICC 656x909, max ink 186% | - | 077bbf717ecf | pass (140267 B, 337 ms) |
| A4 210x297 | png rgb | 300 | 0 | 2480x3508 px | 300 | 862313aad663 | pass (432321 B, 1235 ms) |
| A4 210x297 | png rgb | 300 | 3 | 2551x3579 px | 300 | 98403a171123 | pass (440931 B, 1262 ms) |
| A4 210x297 | png rgb | 150 | 3 | 1276x1789 px | 150 | 31eca321742c | pass (135504 B, 351 ms) |
| A4 210x297 | jpg rgb | 300 | 0 | 2480x3508 px | 300 | dd86a1939b84 | pass (168717 B, 1149 ms) |
| A4 210x297 | jpg rgb | 300 | 3 | 2551x3579 px | 300 | 22b1c2c828a8 | pass (171354 B, 1175 ms) |
| A4 210x297 | jpg rgb | 150 | 3 | 1276x1789 px | 150 | b0a6522f41d5 | pass (55209 B, 367 ms) |
| A4 210x297 | tiff rgb | 300 | 0 | 2480x3508 px | 300 | ba6018ac6463 | pass (323464 B, 1199 ms) |
| A4 210x297 | tiff rgb | 300 | 3 | 2551x3579 px | 300 | 2409bc69b957 | pass (326328 B, 1218 ms) |
| A4 210x297 | tiff rgb | 150 | 3 | 1276x1789 px | 150 | 853ee59f5715 | pass (109870 B, 376 ms) |
| A4 210x297 | pdf rgb | 300 | 0 | 210.0x297.0 mm page, trim 210.0x297.0 mm | - | 71838058caab | pass (333228 B, 1636 ms) |
| A4 210x297 | pdf rgb | 300 | 3 | 216.0x303.0 mm page, trim 210.0x297.0 mm | - | 515e44a87419 | pass (337950 B, 1529 ms) |
| A4 210x297 | pdf rgb | 150 | 3 | 216.0x303.0 mm page, trim 210.0x297.0 mm | - | 0895c944dbef | pass (111304 B, 549 ms) |
| A4 210x297 | tiff cmyk | 300 | 0 | 2480x3508 px CMYK, max ink 196% | 300 | 27d2149b1b02 | pass (563092 B, 4014 ms) |
| A4 210x297 | tiff cmyk | 300 | 3 | 2551x3579 px CMYK, max ink 196% | 300 | 7251de6e472d | pass (568978 B, 3909 ms) |
| A4 210x297 | tiff cmyk | 150 | 3 | 1276x1789 px CMYK, max ink 197% | 150 | afc3b7a9e372 | pass (265566 B, 1013 ms) |
| A4 210x297 | pdf cmyk | 300 | 0 | 210.0x297.0 mm page, trim 210.0x297.0 mm, CMYK ICC 2480x3508, max ink 196% | - | 51aafa6c9b14 | pass (529345 B, 3930 ms) |
| A4 210x297 | pdf cmyk | 300 | 3 | 216.0x303.0 mm page, trim 210.0x297.0 mm, CMYK ICC 2551x3579, max ink 196% | - | f45142b95bab | pass (534184 B, 4013 ms) |
| A4 210x297 | pdf cmyk | 150 | 3 | 216.0x303.0 mm page, trim 210.0x297.0 mm, CMYK ICC 1276x1789, max ink 197% | - | 95543f34e446 | pass (237967 B, 1183 ms) |
| A3 297x420 | png rgb | 300 | 0 | 3508x4961 px | 300 | 0fffc8964b5f | pass (770826 B, 1986 ms) |
| A3 297x420 | png rgb | 300 | 3 | 3579x5031 px | 300 | 3ad22ded6e70 | pass (778282 B, 2237 ms) |
| A3 297x420 | png rgb | 150 | 3 | 1789x2516 px | 150 | 0e37f9eb7fbb | pass (244655 B, 568 ms) |
| A3 297x420 | jpg rgb | 300 | 0 | 3508x4961 px | 300 | 4c68f81256e8 | pass (307487 B, 1947 ms) |
| A3 297x420 | jpg rgb | 300 | 3 | 3579x5031 px | 300 | 3de910b11904 | pass (315888 B, 2102 ms) |
| A3 297x420 | jpg rgb | 150 | 3 | 1789x2516 px | 150 | 45ff280decd2 | pass (95607 B, 579 ms) |
| A3 297x420 | tiff rgb | 300 | 0 | 3508x4961 px | 300 | 9ad937e3e8d5 | pass (539844 B, 2160 ms) |
| A3 297x420 | tiff rgb | 300 | 3 | 3579x5031 px | 300 | fb89de3ffe22 | pass (543966 B, 2254 ms) |
| A3 297x420 | tiff rgb | 150 | 3 | 1789x2516 px | 150 | b2682b6e37bc | pass (182392 B, 682 ms) |
| A3 297x420 | pdf rgb | 300 | 0 | 297.0x420.0 mm page, trim 297.0x420.0 mm | - | adcca6a08251 | pass (570350 B, 2947 ms) |
| A3 297x420 | pdf rgb | 300 | 3 | 303.0x426.0 mm page, trim 297.0x420.0 mm | - | 3f6c9ec8312d | pass (573678 B, 3260 ms) |
| A3 297x420 | pdf rgb | 150 | 3 | 303.0x426.0 mm page, trim 297.0x420.0 mm | - | 1f678875de73 | pass (194697 B, 772 ms) |
| A3 297x420 | tiff cmyk | 300 | 0 | 3508x4961 px CMYK, max ink 198% | 300 | eb7b92e70d70 | pass (879514 B, 7046 ms) |
| A3 297x420 | tiff cmyk | 300 | 3 | 3579x5031 px CMYK, max ink 198% | 300 | f243fb9e3f1b | pass (883720 B, 7799 ms) |
| A3 297x420 | tiff cmyk | 150 | 3 | 1789x2516 px CMYK, max ink 198% | 150 | 85f4cb32516a | pass (374922 B, 1894 ms) |
| A3 297x420 | pdf cmyk | 300 | 0 | 297.0x420.0 mm page, trim 297.0x420.0 mm, CMYK ICC 3508x4961, max ink 198% | - | a9828dfa8d2a | pass (833152 B, 7938 ms) |
| A3 297x420 | pdf cmyk | 300 | 3 | 303.0x426.0 mm page, trim 297.0x420.0 mm, CMYK ICC 3579x5031, max ink 198% | - | 26f8fe1aae03 | pass (838986 B, 8173 ms) |
| A3 297x420 | pdf cmyk | 150 | 3 | 303.0x426.0 mm page, trim 297.0x420.0 mm, CMYK ICC 1789x2516, max ink 198% | - | 3989b856ea32 | pass (345855 B, 2175 ms) |
| Poster 500x500 | png rgb | 300 | 0 | 5906x5906 px | 300 | ea9c46db82df | pass (1566930 B, 3532 ms) |
| Poster 500x500 | png rgb | 300 | 3 | 5976x5976 px | 300 | 6638e68abe0e | pass (1572940 B, 3987 ms) |
| Poster 500x500 | png rgb | 150 | 3 | 2988x2988 px | 150 | e619fd3f6d73 | pass (456155 B, 1066 ms) |
| Poster 500x500 | jpg rgb | 300 | 0 | 5906x5906 px | 300 | e0afbfb81cff | pass (586618 B, 3376 ms) |
| Poster 500x500 | jpg rgb | 300 | 3 | 5976x5976 px | 300 | f7a67ec9e017 | pass (597983 B, 3949 ms) |
| Poster 500x500 | jpg rgb | 150 | 3 | 2988x2988 px | 150 | ab911f57adaa | pass (175109 B, 928 ms) |
| Poster 500x500 | tiff rgb | 300 | 0 | 5906x5906 px | 300 | 8e3dabbe7d54 | pass (992324 B, 3821 ms) |
| Poster 500x500 | tiff rgb | 300 | 3 | 5976x5976 px | 300 | 73bbda74c2f7 | pass (1008522 B, 4018 ms) |
| Poster 500x500 | tiff rgb | 150 | 3 | 2988x2988 px | 150 | 2ed1aff4d9a7 | pass (331070 B, 1123 ms) |
| Poster 500x500 | pdf rgb | 300 | 0 | 500.0x500.0 mm page, trim 500.0x500.0 mm | - | aaf6318a0100 | pass (1031364 B, 5060 ms) |
| Poster 500x500 | pdf rgb | 300 | 3 | 506.0x506.0 mm page, trim 500.0x500.0 mm | - | 5e18cd1f049c | pass (1044835 B, 5227 ms) |
| Poster 500x500 | pdf rgb | 150 | 3 | 506.0x506.0 mm page, trim 500.0x500.0 mm | - | 9c1b52906f3b | pass (354833 B, 1433 ms) |
| Poster 500x500 | tiff cmyk | 300 | 0 | 5906x5906 px CMYK, max ink 198% | 300 | 4993fcc1a88e | pass (1508918 B, 13779 ms) |
| Poster 500x500 | tiff cmyk | 300 | 3 | 5976x5976 px CMYK, max ink 198% | 300 | cd28a09206fd | pass (1527624 B, 14500 ms) |
| Poster 500x500 | tiff cmyk | 150 | 3 | 2988x2988 px CMYK, max ink 194% | 150 | 92736d48ff71 | pass (588098 B, 3702 ms) |
| Poster 500x500 | pdf cmyk | 300 | 0 | 500.0x500.0 mm page, trim 500.0x500.0 mm, CMYK ICC 5906x5906, max ink 198% | - | a39a188f98da | pass (1441547 B, 15380 ms) |
| Poster 500x500 | pdf cmyk | 300 | 3 | 506.0x506.0 mm page, trim 500.0x500.0 mm, CMYK ICC 5976x5976, max ink 198% | - | 8b5d9191fa66 | pass (1459874 B, 15497 ms) |
| Poster 500x500 | pdf cmyk | 150 | 3 | 506.0x506.0 mm page, trim 500.0x500.0 mm, CMYK ICC 2988x2988, max ink 194% | - | 705d760acd9c | pass (553634 B, 3971 ms) |
