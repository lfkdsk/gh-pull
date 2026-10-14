import { SVG } from './vendor/svg.js';

// Each sibling set gets one SVG in its parent's list item. The shared vertical
// trunk is a single path, so row boundaries cannot introduce seams at zoom levels.
export function drawDependencies(root) {
  const drawings = [...root.querySelectorAll('.dependency-children')].map(list => ({
    list,
    canvas: SVG().addTo(list.parentElement).addClass('dependency-connector')
      .attr({ 'aria-hidden': 'true', focusable: 'false' }),
  }));
  const stroke = { color: 'currentColor', width: 1.5, linecap: 'butt', linejoin: 'round' };
  function draw() {
    for (const { list, canvas } of drawings) {
      canvas.clear();
      if (!list.getClientRects().length || parseFloat(getComputedStyle(list).marginInlineStart) < 24) continue;
      const rows = [...list.children].map(entry => ({ entry, row: entry.querySelector(':scope > .pr-row') }));
      const ys = rows.map(({ entry, row }) => entry.offsetTop + Math.min(28, row.offsetHeight / 2));
      const last = ys.at(-1);
      if (last === undefined) continue;
      canvas.node.style.left = `${list.offsetLeft - 24}px`;
      canvas.node.style.top = `${list.offsetTop}px`;
      canvas.size(24, last + 2);
      const head = canvas.marker(8, 8, marker => {
        marker.path('M0 0 L10 5 L0 10 L2 5 Z').fill('currentColor').stroke('none');
      }).viewbox(0, 0, 10, 10).ref(8, 5).attr({ markerUnits: 'userSpaceOnUse', orient: 'auto', overflow: 'visible' });
      // Draw the longest arrow once. Short sibling branches join this same trunk.
      canvas.path(`M24 ${last} H18 Q8 ${last} 8 ${last - 10} V5`)
        .fill('none').stroke(stroke).marker('end', head).addClass('dependency-trunk');
      for (const y of ys.slice(0, -1)) {
        canvas.path(`M24 ${y} H18 Q8 ${y} 8 ${y - 10}`)
          .fill('none').stroke(stroke).addClass('dependency-branch');
      }
    }
  }
  // Layout coordinates (offsetTop/Left) stay in CSS pixels during browser zoom.
  // Watch row resizing as well as the list, including edits and font loading.
  const observer = new ResizeObserver(draw);
  for (const { list } of drawings) {
    observer.observe(list);
    for (const entry of list.children) observer.observe(entry);
  }
  draw();
  return () => {
    observer.disconnect();
    for (const { canvas } of drawings) canvas.remove();
  };
}
