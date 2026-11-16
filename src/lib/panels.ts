// The two business panels: on the home page side by side, and each one again as
// the first screen of its own page, so a panel can grow from the home page into
// its page (PanelTrip.astro).
//  - Agriculture: four product-line photo tiles (ProduceTiles.astro).
//  - Packaging: four products standing in a row, in 3D (PackLineup.astro).

export const PRODUCE = [
  { p: 'sesame', name: 'Humera sesame', img: '/products/photos/sesame-natural.webp' },
  { p: 'pulses', name: 'Pulses', img: '/products/photos/pulses.webp' },
  { p: 'spices', name: 'Spices', img: '/products/photos/spices.webp' },
  { p: 'coffee', name: 'Coffee', img: '/products/photos/coffee.webp' },
];

/** How wide a tile is drawn: two a row on a phone, a quarter of a wide screen. */
export const TILE_SIZES = '(max-width: 860px) 45vw, 24vw';

/**
 * The packaging line-up, in 3D (lineup3d.js): each product folded from its own
 * shape (lib/box-styles.js) at a typical size in cm [width, depth, height], seen
 * from `tilt` degrees above, standing `h` high in the row (its height there, not a
 * measurement). The two boxes open their lids under the pointer. The still renders
 * the page shows first are made from this list: run `node scripts/render-lineup.mjs`
 * after changing it.
 */
export const LINEUP = [
  { id: 'pk_twisted', style: 'bag-twisted', board: 'kraft', cm: [25, 11, 32], tilt: 14, h: 100 },
  { id: 'pk_foil', style: 'pouch', board: 'foil', cm: [16, 8, 24], tilt: 12, h: 74 },
  { id: 'pk_medbox', style: 'carton', board: 'white', cm: [9, 5, 13], tilt: 20, h: 58 },
  { id: 'pk_pizza', style: 'mailer', board: 'kraft', cm: [30, 30, 4.5], tilt: 28, h: 50 },
];
