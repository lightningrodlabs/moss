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

    // Draw X axis labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#999';
    const maxDataLen = Math.max(...this.series.map((s) => s.data.length), 1);
    const seconds = maxDataLen * 2; // 2s polling interval
    ctx.fillText(
      seconds >= 60 ? `${Math.round(seconds / 60)}m ago` : `${seconds}s ago`,
      padding.left,
      padding.top + chartH + 4,
    );
    ctx.fillText('now', padding.left + chartW, padding.top + chartH + 4);

    // Draw data lines
    for (const s of this.series) {
      if (s.data.length < 2) continue;

      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const pointCount = Math.min(s.data.length, this.maxPoints);
      const startIdx = s.data.length - pointCount;

      for (let i = 0; i < pointCount; i++) {
        const x = padding.left + (i / (this.maxPoints - 1)) * chartW;
        const y = padding.top + chartH - (s.data[startIdx + i] / maxVal) * chartH;

        if (i === 0) {
          ctx.moveTo(x, y);
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
