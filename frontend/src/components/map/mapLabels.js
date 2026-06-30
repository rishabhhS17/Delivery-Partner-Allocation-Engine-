// Cross-browser rounded-rect path (no ctx.roundRect needed)
function drawPill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

const PILL_ID = 'dpae-label-pill';

/**
 * Adds a stretchable white pill image to the Mapbox GL map sprite.
 * Must be called inside the Map's onLoad handler before any label layers render.
 * Safe to call multiple times — skips if the image is already registered.
 */
export function addLabelPillImage(map) {
  if (!map || map.hasImage(PILL_ID)) return;

  const W = 60, H = 22, R = 6, SCALE = 2;
  const IW = W * SCALE, IH = H * SCALE;

  const canvas = document.createElement('canvas');
  canvas.width  = IW;
  canvas.height = IH;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // Drop shadow
  ctx.shadowColor   = 'rgba(0,0,0,0.26)';
  ctx.shadowBlur    = 5;
  ctx.shadowOffsetY = 1.5;

  // White pill fill
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  drawPill(ctx, 1.5, 1, W - 3, H - 2.5, R);
  ctx.fill();

  map.addImage(
    PILL_ID,
    { width: IW, height: IH, data: ctx.getImageData(0, 0, IW, IH).data },
    {
      // Horizontal + vertical mid-sections that stretch (corners stay fixed)
      stretchX: [[R * SCALE, (W - R) * SCALE]],
      stretchY: [[R * SCALE, (H - R) * SCALE]],
      // Inner content box where Mapbox places the text (padding from edges)
      content:  [8 * SCALE, 3 * SCALE, (W - 8) * SCALE, (H - 3) * SCALE],
      pixelRatio: SCALE,
    },
  );
}

/**
 * Returns a Mapbox GL symbol-layer config that renders a white pill label
 * above each map feature.
 *
 * @param {object} opts
 * @param {string}         opts.id        Unique layer id
 * @param {string}         opts.source    Source id to attach to
 * @param {*}              opts.textField Mapbox GL expression, e.g. ['get', 'name']
 * @param {Array}         [opts.filter]   Optional Mapbox GL filter expression
 * @param {number}        [opts.minZoom]  Zoom at which labels fully fade in (default 12)
 */
export function makeLabelLayer({ id, source, textField, filter, minZoom = 12 }) {
  return {
    id,
    type: 'symbol',
    source,
    ...(filter ? { filter } : {}),
    layout: {
      'icon-image':             PILL_ID,
      'icon-text-fit':          'both',
      'icon-text-fit-padding':  [3, 8, 3, 8],   // top right bottom left, px
      'text-field':             textField,
      'text-size':              ['interpolate', ['linear'], ['zoom'], 10, 10, 18, 13],
      'text-anchor':            'bottom',
      'text-offset':            [0, -1.3],        // ems above the feature anchor
      'text-font':              ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
      'text-max-width':         12,
      'text-allow-overlap':     false,
      'text-optional':          true,
    },
    paint: {
      'text-color':   '#111111',
      'icon-opacity': ['interpolate', ['linear'], ['zoom'], minZoom - 0.5, 0, minZoom + 0.5, 1],
      'text-opacity': ['interpolate', ['linear'], ['zoom'], minZoom - 0.5, 0, minZoom + 0.5, 1],
    },
  };
}
