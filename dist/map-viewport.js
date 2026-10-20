// Keep one original map image covering the viewport, including during animation.
const bleed = 1;

export function minimumScale(width, height, worldWidth, worldHeight) {
  return Math.max((width + bleed * 2) / worldWidth, (height + bleed * 2) / worldHeight);
}

export function constrainView(view, viewport) {
  const { width, height, worldWidth, worldHeight } = viewport;
  const scale = Math.max(view.scale, minimumScale(width, height, worldWidth, worldHeight));
  return {
    scale,
    x: Math.min(-bleed, Math.max(width - worldWidth * scale + bleed, view.x)),
    y: Math.min(-bleed, Math.max(height - worldHeight * scale + bleed, view.y))
  };
}
