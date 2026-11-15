// The two business panels: on the home page side by side, and each one again as
// the first screen of its own page, so a panel can grow from the home page into
// its page (PanelTrip.astro).
//  - Agriculture: four product-line photo tiles (ProduceTiles.astro).
//  - Packaging: four products standing in a row, in true proportion (PackLineup.astro).

export const PRODUCE = [
  { p: 'sesame', name: 'Humera sesame', img: '/products/photos/sesame-natural.webp' },
  { p: 'pulses', name: 'Pulses', img: '/products/photos/pulses.webp' },
  { p: 'spices', name: 'Spices', img: '/products/photos/spices.webp' },
  { p: 'coffee', name: 'Coffee', img: '/products/photos/coffee.webp' },
];

/** How wide a tile is drawn: two a row on a phone, a quarter of a wide screen. */
export const TILE_SIZES = '(max-width: 860px) 45vw, 24vw';

/** The packaging lineup, tallest to smallest, with heights true to each other. */
export const LINEUP: [string, number][] = [['pk_twisted', 100], ['pk_foil', 86], ['pk_pouch', 74], ['pk_burger', 50]];
