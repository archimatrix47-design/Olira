// The address of a small copy of a catalogue photo (served by lib/thumbs.js).
// No Node imports: the build and the browser use it too.
export const THUMB_WIDTHS = [120, 240, 480];
export const PHOTO_RE = /^(uploads\/(packaging|products)|images\/packaging\/(products|cutouts)|products\/photos)\/[\w.-]+\.(webp|png|jpe?g|avif)$/i;

/** /thumb/<width>/<photo>, or the photo itself when it cannot have one. */
export const thumbUrl = (image, width) => (typeof image === 'string' && PHOTO_RE.test(image.replace(/^\//, '')) && THUMB_WIDTHS.includes(width) ? `/thumb/${width}${image.startsWith('/') ? '' : '/'}${image}` : image);

/** A srcset for a photo shown about `css` pixels wide: 1x and 2x thumbnails. */
export function thumbSet(image, css) {
  const one = THUMB_WIDTHS.find((w) => w >= css) || 480, two = THUMB_WIDTHS.find((w) => w >= css * 2) || 480;
  const a = thumbUrl(image, one), b = thumbUrl(image, two);
  return a === image ? null : `${a} 1x, ${b} 2x`;
}
