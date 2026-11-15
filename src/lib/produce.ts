// The four agriculture product lines shown as photo tiles: in the home page's
// green panel and along the bottom of the agriculture page's first screen
// (ProduceTiles.astro). One list, so both pages show the same tiles and the
// panel can grow from one page into the other.
export const PRODUCE = [
  { p: 'sesame', name: 'Humera sesame', img: '/products/photos/sesame-natural.webp' },
  { p: 'pulses', name: 'Pulses', img: '/products/photos/pulses.webp' },
  { p: 'spices', name: 'Spices', img: '/products/photos/spices.webp' },
  { p: 'coffee', name: 'Coffee', img: '/products/photos/coffee.webp' },
];

/** How wide a tile is drawn: two a row on a phone, a quarter of a wide screen. */
export const TILE_SIZES = '(max-width: 860px) 45vw, 24vw';
