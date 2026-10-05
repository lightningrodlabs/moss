export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** CSS transform that moves `from` onto `to` with top-left origin, or undefined when the target is unusable. */
export function morphTransform(from: Rect, to: Rect | undefined): string | undefined {
  if (!to || to.width === 0 || to.height === 0) return undefined;
  const scale = (to.width / from.width).toFixed(4);
  return `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`;
}
