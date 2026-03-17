import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

export interface ChartSeries {
  label: string;
  color: string;
  data: number[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

@customElement('memory-chart')
export class MemoryChart extends LitElement {
  @property()
  title = '';

  @property({ type: Number })
  maxPoints = 60;

  /** Seconds between samples — used to compute X-axis time labels. */
  @property({ type: Number })
  intervalSecs = 2;

  /** When true, data fills the full chart width (maxPoints = data.length). */
  @property({ type: Boolean })
  fillWidth = false;

  @property({ type: Array })
  series: ChartSeries[] = [];

  @property({ type: Number })
  width = 400;

  @property({ type: Number })
  height = 150;

  @query('canvas')
  _canvas!: HTMLCanvasElement;

  updated() {
    this.drawChart();
  }

  private drawChart() {
    const canvas = this._canvas;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const titleH = this.title ? 16 : 0;
    const legendH = 16;
    const headerH = titleH + legendH;
    const totalH = this.height + headerH;
    canvas.width = this.width * dpr;
    canvas.height = totalH * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, this.width, totalH);

    // Draw title row
    if (this.title) {
      ctx.fillStyle = '#888';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.title, 62, titleH / 2);
    }

    // Draw legend row below title
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const legendY = titleH + legendH / 2;
    let legendX = 62;
    for (const s of this.series) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(legendX, legendY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#666';
      const lastVal = s.data.length > 0 ? s.data[s.data.length - 1] : 0;
      const text = `${s.label}: ${formatBytes(lastVal)}`;
      ctx.fillText(text, legendX + 8, legendY);
      legendX += ctx.measureText(text).width + 24;
    }

    // Chart area starts below header
    const padding = { top: headerH + 4, right: 12, bottom: 20, left: 60 };
    const chartW = this.width - padding.left - padding.right;
    const chartH = totalH - padding.top - padding.bottom;

    // Find max value across all series for Y scale
    let maxVal = 0;
    for (const s of this.series) {
      for (const v of s.data) {
        if (v > maxVal) maxVal = v;
      }
    }
    // Add 10% headroom, minimum 1KB
    maxVal = Math.max(maxVal * 1.1, 1024);

    // Draw background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(padding.left, padding.top, chartW, chartH);

    // Draw grid lines and Y labels
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#999';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + chartH - (i / gridLines) * chartH;
      const val = (i / gridLines) * maxVal;

      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      ctx.fillText(formatBytes(val), padding.left - 4, y);
    }

    // Effective maxPoints: in fillWidth mode, use data length so the chart is fully occupied.
    const maxDataLen = Math.max(...this.series.map((s) => s.data.length), 1);
    const effectiveMax = this.fillWidth ? maxDataLen : this.maxPoints;

    // For fixed windows the left label shows the full window span;
    // for fillWidth ("all") it shows the actual elapsed time.
    const windowSecs = this.fillWidth
      ? maxDataLen * this.intervalSecs
      : effectiveMax * this.intervalSecs;

    const formatTime = (secs: number): string => {
      if (secs >= 3600) return `${(secs / 3600).toFixed(1)}h`;
      if (secs >= 60) return `${Math.round(secs / 60)}m`;
      return `${secs}s`;
    };

    // Draw vertical grid lines with time tick labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#999';
    const xGridLines = 4;
    for (let i = 0; i <= xGridLines; i++) {
      const x = padding.left + (i / xGridLines) * chartW;
      // faint vertical grid (skip left edge, already has Y axis)
      if (i > 0 && i < xGridLines) {
        ctx.strokeStyle = '#282840';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
      }
      const tickSecs = windowSecs * (1 - i / xGridLines);
      const label = i === xGridLines ? 'now' : `${formatTime(tickSecs)} ago`;
      ctx.fillText(label, x, padding.top + chartH + 4);
    }

    // Draw data lines.
    // Points are right-aligned: the newest point (last in array) is always at the
    // right edge of the chart.  Empty space appears on the left while the buffer
    // is still filling up (fixed windows only; fillWidth always fills).
    const spacing = effectiveMax > 1 ? chartW / (effectiveMax - 1) : 0;
    for (const s of this.series) {
      if (s.data.length < 2) continue;

      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const pointCount = Math.min(s.data.length, effectiveMax);
      const startIdx = s.data.length - pointCount;
      let started = false;

      for (let i = 0; i < pointCount; i++) {
        // i=0 is oldest visible, i=pointCount-1 is newest (right edge)
        const x = padding.left + chartW - (pointCount - 1 - i) * spacing;
        const y = padding.top + chartH - (s.data[startIdx + i] / maxVal) * chartH;

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
  }

  render() {
    return html`
      <canvas
        style="width: ${this.width}px; height: ${this.height + (this.title ? 32 : 16)}px;"
      ></canvas>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }
    canvas {
      border-radius: 4px;
    }
  `;
}
