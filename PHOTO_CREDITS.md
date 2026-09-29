# Photo credits

The packaging photographs are from Pexels, used under the Pexels License
(free commercial use and modification, no attribution required; do not sell
unaltered copies or redistribute them as stock photos).
https://www.pexels.com/license/

| File | Photographer | Source |
|---|---|---|
| `public/images/packaging/packaging-hero-*` | Hanafi Mellek | https://www.pexels.com/photo/32166686/ |
| `public/images/packaging/products/flat-handle-bag-v2.webp` | Mr. Mockup | https://www.pexels.com/photo/12024975/ (right-hand bag, cropped) |
| `public/images/packaging/products/wide-flat-handle-bag-v2.webp` | Mr. Mockup | https://www.pexels.com/photo/12024975/ (left-hand bag, cropped) |

The bags in the mockup studio are the packaging products managed in the admin
(Website, Packaging products). Each has a photo on a plain white background,
an optional identical shot on black for dark mode, and the four print corners
set with the corner editor. Replace these stock photos with Olira's own bags
from there; no code change is needed.

## Unsplash (catalogue products, 2026-09-27)

Licensed under the Unsplash License (free commercial use and modification, no
attribution required; do not sell unaltered copies or compile them into a
competing photo service). https://unsplash.com/license

| File | Photographer | Source |
|---|---|---|
| `public/images/packaging/products/twisted-handle-bag-v2.webp` | Dmitry Mashkin | https://unsplash.com/photos/adCT4qOQeY4 |
| `public/images/packaging/products/square-bottom-bag-v2.webp` | Brando Makes Branding | https://unsplash.com/photos/Dk7vG3MJ3hU |
| `public/images/packaging/products/v-bottom-bag-v2.webp` | Gabre Cameron | https://unsplash.com/photos/bjVCeJNsLCU |
| `public/images/packaging/products/bakery-window-box-v2.webp` | Tanaphong Toochinda | https://unsplash.com/photos/_f8S_o9xQK8 |
| `public/images/packaging/products/burger-box-v2.webp` | Christopher Bill | https://unsplash.com/photos/BZq-W3x6r24 |
| `public/images/packaging/products/medical-packet-v2.webp` | Brando Makes Branding | https://unsplash.com/photos/pbA1c4RN63A (small maker's mark retouched out) |
| `public/images/packaging/products/pizza-box-v2.webp` | Karsten Winegeart | https://unsplash.com/photos/tTJfjOpt2kE (printed lid: catalogue photo only, not in the studio) |

These are stock photos standing in for Olira's own products. Pizza boxes are
not in the mockup studio because none of the approved photos shows a blank lid;
upload a photo of a plain lid in the admin and place the four print corners to
add them.

All product photos follow one standard, applied by a script to the photos above:
cut out from their original background, straightened to face the camera where
the product is flat (the V-bottom bag and the envelope), light evened across the
product, and set on the same light studio backdrop at the same scale, on the
same floor line, with the same soft shadow (1200 x 1500 pixels). Photos of
Olira's own products should be taken the same way: straight on, at bag height,
on a plain white or light grey background, in soft even light.

The same script also saves each product on its own, with a transparent
background, in `public/images/packaging/cutouts/` (listed with their print
areas in `src/data/cutouts.json`). These are the products standing on the kraft
on the home page and in the catalogue, where the visitor's brand is printed on
them as they type. They are the same licensed photos, cropped to the product.
A product whose photo the admin has replaced shows the admin's photo instead,
without the live print, until a cut-out is made for it.

## mockups-design.com packaging mockups

Rendered from the free low-resolution PSD mockups by mockups-design.com
(https://mockups-design.com/free-packaging-mockups/), downloaded 2026-09-28.
Licence (license.pdf in each download): royalty free, commercial use allowed,
no attribution required; flattened images such as JPG, PNG or WebP may be
distributed, the PSD files may not. The PSDs are therefore not in this
repository. Each was rendered with the maker's sample artwork switched off, then
put through the same photo standard as the photos above.

| File (products/ and cutouts/) | Mockup |
|---|---|
| `foil-gusseted-bag-v2.webp` | https://mockups-design.com/packaging/metallic-gusseted-food-bag-mockup/ |
| `zip-foil-pouch-v2.webp` | https://mockups-design.com/packaging/self-zip-foil-bag-mockup-metallic/ |
| `block-bottom-bag-v2.webp` | https://mockups-design.com/packaging/kraft-paper-bag-mockup-2/ |
| `kraft-stand-up-pouch-v2.webp` | https://mockups-design.com/packaging/kraft-paper-flat-bottom-pouch-mockup/ |
| `medical-sachet-v2.webp` | https://mockups-design.com/packaging/matt-sachet-mockup/ |
| `medicine-box-v2.webp` | https://mockups-design.com/packaging/clean-packaging-box-mockup-110x70x30mm/ |
| `pillow-window-box-v2.webp` | https://mockups-design.com/packaging/kraft-paper-pillow-box-with-window-mockup/ |
| `food-tray-v2.webp` | https://mockups-design.com/packaging/kraft-paper-food-tray-mockup/ |
| `fries-carton-v2.webp` | https://mockups-design.com/packaging/french-fries-carton-mockup/ |
