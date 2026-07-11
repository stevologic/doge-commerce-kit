/* D3-powered dashboard widgets for the Statistics page: an animated price
   sparkline in the header, fed by loaded candles (doge:candles) and live
   ticks (doge:price) dispatched by doge_tools.js. */
(function () {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function initSparkline() {
    const svg = document.getElementById("dashSparkline");
    if (!svg || typeof d3 === "undefined") return;
    const sel = d3.select(svg);
    const width = 280;
    const height = 64;
    const pad = 4;

    const defs = sel.append("defs");
    const gradient = defs.append("linearGradient")
      .attr("id", "dashSparkFill")
      .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
    gradient.append("stop").attr("offset", "0%").attr("stop-color", "rgba(244, 189, 42, 0.55)");
    gradient.append("stop").attr("offset", "100%").attr("stop-color", "rgba(244, 189, 42, 0.02)");

    const areaPath = sel.append("path").attr("fill", "url(#dashSparkFill)");
    const linePath = sel.append("path")
      .attr("fill", "none")
      .attr("stroke", "#f4bd2a")
      .attr("stroke-width", 2)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round");
    const dot = sel.append("circle")
      .attr("r", 3)
      .attr("fill", "#ffd65c")
      .attr("stroke", "rgba(255, 255, 255, 0.8)")
      .attr("stroke-width", 1)
      .style("opacity", 0);

    let points = [];
    let drawnOnce = false;

    function render(livePrice) {
      if (!points.length) return;
      const values = livePrice ? points.slice(0, -1).concat([{ ...points.at(-1), close: livePrice }]) : points;
      const x = d3.scaleLinear().domain([0, values.length - 1]).range([pad, width - pad]);
      const [min, max] = d3.extent(values, (p) => p.close);
      const y = d3.scaleLinear().domain([min === max ? min * 0.999 : min, max === min ? max * 1.001 : max]).range([height - pad, pad]);
      const line = d3.line().x((p, i) => x(i)).y((p) => y(p.close)).curve(d3.curveMonotoneX);
      const area = d3.area().x((p, i) => x(i)).y0(height - pad).y1((p) => y(p.close)).curve(d3.curveMonotoneX);
      linePath.attr("d", line(values));
      areaPath.attr("d", area(values));
      dot.style("opacity", 1)
        .attr("cx", x(values.length - 1))
        .attr("cy", y(values.at(-1).close));
      if (!drawnOnce && !reducedMotion) {
        drawnOnce = true;
        const total = linePath.node().getTotalLength();
        linePath
          .attr("stroke-dasharray", `${total} ${total}`)
          .attr("stroke-dashoffset", total)
          .transition().duration(1100).ease(d3.easeCubicOut)
          .attr("stroke-dashoffset", 0)
          .on("end", () => linePath.attr("stroke-dasharray", null));
      }
    }

    document.addEventListener("doge:candles", (event) => {
      const rows = event.detail?.points || [];
      points = rows.slice(-90);
      render();
    });
    document.addEventListener("doge:price", (event) => {
      const price = Number(event.detail?.price || 0);
      if (price > 0) render(price);
    });
  }

  function init() {
    initSparkline();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
