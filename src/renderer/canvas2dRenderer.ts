/**
 * 2D Canvas Renderer
 * Renders gymnasium seating layouts on HTML5 Canvas
 * Designed to be decoupled from layout generation
 */

import { GymnasiumShape, LayoutAlert, LayoutOutput, RenderContext, RenderOptions, Seat, ZoneType } from '../core/types'

export class Canvas2DRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private layout: LayoutOutput | null = null
  private layoutAlert: LayoutAlert | null = null
  private renderContext: RenderContext
  private renderOptions: RenderOptions

  // Theme colors
  private colors = {
    light: {
      background: '#ffffff',
      grid: '#e0e0e0',
      seat: '#3b82f6',
      seatAccessible: '#10b981',
      seatVip: '#f59e0b',
      seatBleacher: '#fb923c',
      zone: {
        stage: '#ef4444',
        vip: '#f59e0b',
        blocked: '#9ca3af',
        aisle: '#f3f4f6',
        bleacher: '#fdba74'
      },
      text: '#1f2937',
      border: '#d1d5db'
    },
    dark: {
      background: '#1f2937',
      grid: '#374151',
      seat: '#60a5fa',
      seatAccessible: '#34d399',
      seatVip: '#fcd34d',
      seatBleacher: '#fbbf24',
      zone: {
        stage: '#f87171',
        vip: '#fcd34d',
        blocked: '#6b7280',
        aisle: '#111827',
        bleacher: '#f59e0b'
      },
      text: '#f9fafb',
      border: '#4b5563'
    }
  }

  constructor(canvasElement: HTMLCanvasElement, initialOptions?: Partial<RenderOptions>) {
    this.canvas = canvasElement
    const context = this.canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not get 2D canvas context')
    }
    this.ctx = context

    this.renderOptions = {
      showGrid: true,
      showLabels: true,
      showZones: true,
      showAisles: true,
      highlightAccessible: true,
      showLegend: true,
      showWarnings: true,
      showMeasurements: true,
      theme: 'light',
      ...initialOptions
    }

    this.renderContext = {
      scale: 30, // 30 pixels per meter by default
      offsetX: 0,
      offsetY: 0,
      width: this.canvas.width,
      height: this.canvas.height
    }

    this.setupResponsiveness()
  }

  /**
   * Make canvas responsive to window size
   */
  private setupResponsiveness(): void {
    const resizeCanvas = () => {
      const container = this.canvas.parentElement
      if (!container) return

      const rect = container.getBoundingClientRect()
      this.canvas.width = rect.width
      this.canvas.height = rect.height

      this.renderContext.width = this.canvas.width
      this.renderContext.height = this.canvas.height

      if (this.layout) {
        this.fitLayoutInView()
      }

      this.render()
    }

    window.addEventListener('resize', resizeCanvas)
    resizeCanvas()
  }

  /**
   * Load layout for rendering
   */
  loadLayout(layout: LayoutOutput): void {
    this.layout = layout
    this.fitLayoutInView()
    this.render()
  }

  setLayoutAlert(alert: LayoutAlert | null): void {
    this.layoutAlert = alert
    if (this.layout) {
      this.render()
    }
  }

  /**
   * Calculate optimal scale and offset to fit layout in view
   */
  private fitLayoutInView(): void {
    if (!this.layout) return

    const padding = 50 // pixels

    // Find bounds of all seats and zones
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    // Check seats
    for (const seat of this.layout.seats) {
      const halfW = seat.dimension.width / 2
      const halfD = seat.dimension.depth / 2
      minX = Math.min(minX, seat.position.x - halfW)
      maxX = Math.max(maxX, seat.position.x + halfW)
      minY = Math.min(minY, seat.position.y - halfD)
      maxY = Math.max(maxY, seat.position.y + halfD)
    }

    // Check zones
    for (const zone of this.layout.zones) {
      minX = Math.min(minX, zone.bounds.minX)
      maxX = Math.max(maxX, zone.bounds.maxX)
      minY = Math.min(minY, zone.bounds.minY)
      maxY = Math.max(maxY, zone.bounds.maxY)
    }

    const width = maxX - minX
    const height = maxY - minY

    const availableWidth = this.renderContext.width - 2 * padding
    const availableHeight = this.renderContext.height - 2 * padding

    const scaleX = availableWidth / width
    const scaleY = availableHeight / height

    this.renderContext.scale = Math.min(scaleX, scaleY, 50) // Cap at 50 px/m

    this.renderContext.offsetX = padding - minX * this.renderContext.scale
    this.renderContext.offsetY = padding - minY * this.renderContext.scale
  }

  /**
   * Main render loop
   */
  private render(): void {
    this.clearCanvas()

    if (!this.layout) {
      this.drawPlaceholder()
      return
    }

    if (this.renderOptions.showGrid) {
      this.drawGrid()
    }

    if (this.renderOptions.showZones) {
      this.drawZones()
    }

    // Draw gym border and label before seats and overlays
    this.drawGymBorder()
    
    // Draw gym dimensions (if no stage present)
    this.drawGymDimensions()

    this.drawSeats()

    if (this.layout.seats.length === 0) {
      this.drawEmptyLayoutMessage()
    }

    if (this.renderOptions.showMeasurements) {
      this.drawMeasurements()
    }

    this.drawInfo()

    if (this.renderOptions.showLegend) {
      this.drawLegend()
    }

    if (this.renderOptions.showWarnings && this.layoutAlert) {
      this.drawLayoutAlert()
    }
  }

  /**
   * Draw a red border showing the gym's size and coverage, with label and dimension text
   */
  private drawGymBorder(): void {
    if (!this.layout || !this.layout.config) return
    const config = this.layout.config;
    // Draw border around full gym dimensions
    const minX = 0;
    const minY = 0;
    const maxX = config.width;
    const maxY = config.length;
    const x1 = minX * this.renderContext.scale + this.renderContext.offsetX;
    const y1 = minY * this.renderContext.scale + this.renderContext.offsetY;
    const width = (maxX - minX) * this.renderContext.scale;
    const height = (maxY - minY) * this.renderContext.scale;

    // Draw red border
    this.ctx.save();
    this.ctx.strokeStyle = '#ef4444';
    this.ctx.lineWidth = 4;
    this.ctx.globalAlpha = 0.85;
    this.ctx.setLineDash([8, 6]);
    this.ctx.strokeRect(x1, y1, width, height);
    this.ctx.setLineDash([]);
    this.ctx.globalAlpha = 1;

    // Draw label and dimensions (optional)
    // Skip gym text if stage zone exists (stage label takes priority)
    const hasStage = this.layout.zones?.some(z => z.type === ZoneType.STAGE);
    if (this.renderOptions.showMeasurements && !hasStage) {
      const fontSize = 16;
      this.ctx.font = `bold ${fontSize}px sans-serif`;
      this.ctx.fillStyle = '#ef4444';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'top';
      const labelText = config.name || 'Gym';
      this.ctx.fillText(labelText, x1 + 8, y1 + 8);

      const dimFont = 14;
      this.ctx.font = `${dimFont}px monospace`;
      const dimText = `${config.width.toFixed(2)}m × ${config.length.toFixed(2)}m`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(dimText, x1 + width / 2, y1 + 8);
    }

    this.ctx.restore();
  }

  /**
   * Clear canvas
   */
  private clearCanvas(): void {
    const theme = this.colors[this.renderOptions.theme || 'light']
    this.ctx.fillStyle = theme.background
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /**
   * Draw measurement grid
   */
  private drawGrid(): void {
    const theme = this.colors[this.renderOptions.theme || 'light']
    const spacing = 1 // 1 meter
    const pixelSpacing = spacing * this.renderContext.scale

    this.ctx.strokeStyle = theme.grid
    this.ctx.lineWidth = 0.5
    this.ctx.globalAlpha = 0.3

    // Vertical lines
    for (let x = this.renderContext.offsetX; x < this.canvas.width; x += pixelSpacing) {
      this.ctx.beginPath()
      this.ctx.moveTo(x, 0)
      this.ctx.lineTo(x, this.canvas.height)
      this.ctx.stroke()
    }

    // Horizontal lines
    for (let y = this.renderContext.offsetY; y < this.canvas.height; y += pixelSpacing) {
      this.ctx.beginPath()
      this.ctx.moveTo(0, y)
      this.ctx.lineTo(this.canvas.width, y)
      this.ctx.stroke()
    }

    this.ctx.globalAlpha = 1
  }

  private drawZones(): void {
    if (!this.layout) return

    const theme = this.colors[this.renderOptions.theme || 'light']

    // Draw non-aisle zones first
    for (const zone of this.layout.zones) {
      if (zone.type === ZoneType.AISLE) {
        continue
      }

      const x1 = zone.bounds.minX * this.renderContext.scale + this.renderContext.offsetX
      const y1 = zone.bounds.minY * this.renderContext.scale + this.renderContext.offsetY
      const x2 = zone.bounds.maxX * this.renderContext.scale + this.renderContext.offsetX
      const y2 = zone.bounds.maxY * this.renderContext.scale + this.renderContext.offsetY

      const width = x2 - x1
      const height = y2 - y1

      // Draw zone
      const zoneColor = theme.zone[zone.type as keyof typeof theme.zone]
      this.ctx.fillStyle = zoneColor
      this.ctx.globalAlpha = 0.3
      this.ctx.fillRect(x1, y1, width, height)

      // Draw border
      this.ctx.strokeStyle = zoneColor
      this.ctx.lineWidth = 2
      this.ctx.globalAlpha = 1
      this.ctx.strokeRect(x1, y1, width, height)

      // Draw label (always show stage label; optional for others)
      if ((this.renderOptions.showLabels || zone.type === ZoneType.STAGE) && zone.label) {
        this.ctx.fillStyle = theme.text
        this.ctx.font = '12px sans-serif'
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        this.ctx.fillText(zone.label, (x1 + x2) / 2, (y1 + y2) / 2)
      }

      // Draw dimension text for zones with fixed font size (readable at any zoom)
      if (this.renderOptions.showMeasurements) {
        const zoneWidth = zone.bounds.maxX - zone.bounds.minX
        const zoneHeight = zone.bounds.maxY - zone.bounds.minY
        
        let dimText: string
        dimText = `${zoneWidth.toFixed(2)}m × ${zoneHeight.toFixed(2)}m`
        
        this.ctx.save()
        this.ctx.font = 'bold 10px monospace'
        this.ctx.fillStyle = theme.text
        this.ctx.globalAlpha = 0.85
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        
        // Position dimension text at bottom-center of zone (avoid label overlap)
        const textX = (x1 + x2) / 2
        const textY = y2 - 12 // 12 pixels from bottom edge
        this.ctx.fillText(dimText, textX, textY)
        this.ctx.restore()
      }
    }

    // Draw aisles last with solid fill and no transparency
    for (const zone of this.layout.zones) {
      if (zone.type !== ZoneType.AISLE) {
        continue
      }

      const x1 = zone.bounds.minX * this.renderContext.scale + this.renderContext.offsetX
      const y1 = zone.bounds.minY * this.renderContext.scale + this.renderContext.offsetY
      const x2 = zone.bounds.maxX * this.renderContext.scale + this.renderContext.offsetX
      const y2 = zone.bounds.maxY * this.renderContext.scale + this.renderContext.offsetY

      // Render aisles as solid strips with light gray fill
      this.ctx.fillStyle = '#ededed'
      this.ctx.globalAlpha = 1
      this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1)

      // Optional: border
      this.ctx.strokeStyle = '#999999'
      this.ctx.lineWidth = 1
      this.ctx.globalAlpha = 1
      this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
    }
  }

  /**
   * Draw gym dimensions with label and measurements
   */
  private drawGymDimensions(): void {
    if (!this.layout || !this.layout.config) return
    
    const config = this.layout.config
    const theme = this.colors[this.renderOptions.theme || 'light']
    
    // Use full gym dimensions, not usable area
    const minX = 0
    const minY = 0
    
    const x1 = minX * this.renderContext.scale + this.renderContext.offsetX
    const y1 = minY * this.renderContext.scale + this.renderContext.offsetY
    
    if (this.renderOptions.showMeasurements) {
      this.ctx.save()
      
      // Gym label and dimensions at top-left corner
      const fontSize = 12
      this.ctx.font = `bold ${fontSize}px sans-serif`
      this.ctx.fillStyle = theme.text
      this.ctx.globalAlpha = 0.7
      this.ctx.textAlign = 'left'
      this.ctx.textBaseline = 'top'
      this.ctx.fillText('Gym', x1 + 8, y1 + 8)
      
      // Gym dimensions below label (full gym, not usable area)
      const dimText = `${config.width.toFixed(2)}m × ${config.length.toFixed(2)}m`
      this.ctx.font = 'bold 10px monospace'
      this.ctx.fillText(dimText, x1 + 8, y1 + 22)
      
      this.ctx.restore()
    }
  }

  /**
   * Draw seats
   */
  private drawSeats(): void {
    if (!this.layout) return

    const theme = this.colors[this.renderOptions.theme || 'light']
    const bleacherRows = new Map<number, Seat[]>()

    for (const seat of this.layout.seats) {
      if (seat.metadata.bleacher) {
        const rowSeats = bleacherRows.get(seat.metadata.row) || []
        rowSeats.push(seat)
        bleacherRows.set(seat.metadata.row, rowSeats)
        continue
      }

      const x = seat.position.x * this.renderContext.scale + this.renderContext.offsetX
      const y = seat.position.y * this.renderContext.scale + this.renderContext.offsetY
      const width = seat.dimension.width * this.renderContext.scale
      const height = seat.dimension.depth * this.renderContext.scale

      // Determine color based on occupancy directly (green filled, blue empty)
      const color = seat.metadata.occupied ? '#10b981' : '#3b82f6'
      // Draw seat rectangle
      this.ctx.fillStyle = color
      this.ctx.globalAlpha = seat.metadata.blocked ? 0.3 : 1

      this.ctx.fillRect(x - width / 2, y - height / 2, width, height)
      // Draw border
      this.ctx.strokeStyle = 'rgba(0,0,0,0.2)'
      this.ctx.lineWidth = 1
      this.ctx.globalAlpha = 1
      this.ctx.strokeRect(x - width / 2, y - height / 2, width, height)

      // Draw seat number unless the seat is too small to keep text legible.
      if (this.renderOptions.showLabels && width > 14 && height > 10 && seat.metadata.seatNumber) {
        this.ctx.fillStyle = 'white'
        this.ctx.font = `bold ${Math.max(8, Math.min(width * 0.45, height * 0.7, 14))}px sans-serif`
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        this.ctx.fillText(seat.metadata.seatNumber, x, y)
      }
    }

    bleacherRows.forEach(rowSeats => this.drawBleacherRow(rowSeats, theme))

    this.ctx.globalAlpha = 1
  }

  private drawBleacherRow(rowSeats: Seat[], theme: (typeof this.colors)['light']): void {
    if (rowSeats.length === 0 || !this.layout?.config?.bleachers) return

    const scale = this.renderContext.scale
    const stepDepth = this.layout.config.bleachers.stepDepth * scale
    const orderedSeats = this.orderBleacherRowSeats(rowSeats)
    const stepIndex = Math.max(0, rowSeats[0].metadata.row - 1000)

    this.ctx.save()
    if (
      this.layout.config.shape === GymnasiumShape.RECTANGLE ||
      this.layout.config.shape === GymnasiumShape.SQUARE
    ) {
      this.drawRectangularBleacherBand(stepIndex, theme)
    } else {
      this.drawConnectedBleacherPath(orderedSeats, stepDepth, theme)
    }

    for (const seat of orderedSeats) {
      const color = seat.metadata.occupied ? '#10b981' : '#3b82f6'
      const x = seat.position.x * scale + this.renderContext.offsetX
      const y = seat.position.y * scale + this.renderContext.offsetY
      const markerWidth = seat.dimension.width * scale
      const markerHeight = seat.dimension.depth * scale
      const markerX = x - markerWidth / 2
      const markerY = y - markerHeight / 2

      this.ctx.fillStyle = color
      this.ctx.fillRect(markerX, markerY, markerWidth, markerHeight)
      this.ctx.strokeStyle = theme.seatBleacher
      this.ctx.lineWidth = 1.5
      this.ctx.strokeRect(markerX, markerY, markerWidth, markerHeight)

      if (this.renderOptions.showLabels && markerWidth > 14 && markerHeight > 10 && seat.metadata.seatNumber) {
        this.ctx.fillStyle = 'white'
        this.ctx.font = `bold ${Math.max(8, Math.min(markerWidth * 0.38, markerHeight * 0.7, 12))}px sans-serif`
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        this.ctx.fillText(seat.metadata.seatNumber, markerX + markerWidth / 2, markerY + markerHeight / 2)
      }
    }

    this.ctx.restore()
  }

  private drawRectangularBleacherBand(stepIndex: number, theme: (typeof this.colors)['light']): void {
    if (!this.layout?.config?.bleachers) return

    const scale = this.renderContext.scale
    const stepDepth = this.layout.config.bleachers.stepDepth
    const minX = this.layout.config.minMargin + stepIndex * stepDepth
    const maxX = this.layout.config.width - this.layout.config.minMargin - stepIndex * stepDepth
    const maxY = this.layout.config.length - this.layout.config.minMargin - stepIndex * stepDepth
    const stage = this.layout.zones.find(zone => zone.type === ZoneType.STAGE)
    const stageMaxY = stage ? stage.bounds.maxY : this.layout.config.minMargin
    const bandThickness = stepDepth
    const entranceWidth = this.layout.config.bleachers.entranceWidth
    const entranceStart = (this.layout.config.width - entranceWidth) / 2
    const entranceEnd = entranceStart + entranceWidth

    const segments = [
      { x: minX, y: stageMaxY, width: bandThickness, height: Math.max(0, maxY - stageMaxY) },
      { x: maxX - bandThickness, y: stageMaxY, width: bandThickness, height: Math.max(0, maxY - stageMaxY) },
      { x: minX, y: maxY - bandThickness, width: Math.max(0, entranceStart - minX), height: bandThickness },
      { x: entranceEnd, y: maxY - bandThickness, width: Math.max(0, maxX - entranceEnd), height: bandThickness }
    ]

    this.ctx.fillStyle = theme.zone.bleacher
    this.ctx.globalAlpha = 0.55
    this.ctx.strokeStyle = theme.seatBleacher
    this.ctx.lineWidth = 2

    for (const segment of segments) {
      if (segment.width <= 0 || segment.height <= 0) continue
      const x = segment.x * scale + this.renderContext.offsetX
      const y = segment.y * scale + this.renderContext.offsetY
      const width = segment.width * scale
      const height = segment.height * scale
      this.ctx.fillRect(x, y, width, height)
      this.ctx.globalAlpha = 1
      this.ctx.strokeRect(x, y, width, height)
      this.ctx.globalAlpha = 0.55
    }
    this.ctx.globalAlpha = 1
  }

  private drawConnectedBleacherPath(
    orderedSeats: Seat[],
    stepDepth: number,
    theme: (typeof this.colors)['light']
  ): void {
    const scale = this.renderContext.scale
    this.ctx.strokeStyle = theme.zone.bleacher
    this.ctx.lineWidth = Math.max(6, stepDepth)
    this.ctx.lineJoin = 'round'
    this.ctx.lineCap = 'round'
    this.ctx.globalAlpha = 0.7
    this.ctx.beginPath()

    orderedSeats.forEach((seat, index) => {
      const x = seat.position.x * scale + this.renderContext.offsetX
      const y = seat.position.y * scale + this.renderContext.offsetY
      if (index === 0) {
        this.ctx.moveTo(x, y)
      } else {
        this.ctx.lineTo(x, y)
      }
    })

    this.ctx.stroke()
    this.ctx.strokeStyle = theme.seatBleacher
    this.ctx.lineWidth = 2
    this.ctx.globalAlpha = 1
    this.ctx.stroke()
  }

  private orderBleacherRowSeats(rowSeats: Seat[]): Seat[] {
    if (!this.layout?.config?.bleachers) return rowSeats

    const depth = this.layout.config.bleachers.width
    const minX = this.layout.config.minMargin
    const maxX = this.layout.config.width - this.layout.config.minMargin
    const maxY = this.layout.config.length - this.layout.config.minMargin
    const stage = this.layout.zones.find(zone => zone.type === ZoneType.STAGE)
    const stageMaxY = stage ? stage.bounds.maxY : this.layout.config.minMargin

    const leftSeats = rowSeats
      .filter(seat => seat.position.x <= minX + depth + 0.05 && seat.position.y >= stageMaxY - 0.05)
      .sort((a, b) => a.position.y - b.position.y)
    const bottomSeats = rowSeats
      .filter(seat => seat.position.y >= maxY - depth - 0.05)
      .sort((a, b) => a.position.x - b.position.x)
    const rightSeats = rowSeats
      .filter(seat => seat.position.x >= maxX - depth - 0.05 && seat.position.y >= stageMaxY - 0.05)
      .sort((a, b) => b.position.y - a.position.y)

    const ordered = [...leftSeats, ...bottomSeats, ...rightSeats]
    return ordered.length > 0 ? ordered : rowSeats
  }

  /**
   * Draw information overlay
   */
  private drawInfo(): void {
    if (!this.layout) return

    const theme = this.colors[this.renderOptions.theme || 'light']

    const info = [
      `Total Seats: ${this.layout.totalSeats}`,
      `Occupied: ${this.layout.stats.seatsByOccupancy.occupied}`,
      `Empty: ${this.layout.stats.seatsByOccupancy.empty}`,
      `Utilization: ${(this.layout.utilizationRatio * 100).toFixed(1)}%`,
    ]

    const fontSize = 12
    const lineHeight = 18
    const padding = 15
    const boxWidth = 240

    // Semi-transparent background
    this.ctx.fillStyle = theme.background
    this.ctx.globalAlpha = 0.92
    this.ctx.fillRect(padding, padding, boxWidth, info.length * lineHeight + padding)

    // Border
    this.ctx.strokeStyle = theme.border
    this.ctx.lineWidth = 2
    this.ctx.globalAlpha = 1
    this.ctx.strokeRect(padding, padding, boxWidth, info.length * lineHeight + padding)

    // Text
    this.ctx.fillStyle = theme.text
    this.ctx.font = `${fontSize}px monospace`
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'top'

    info.forEach((line, i) => {
      this.ctx.fillText(line, padding + 10, padding + 8 + i * lineHeight)
    })
  }

  /**
   * Draw measurements (gym dimensions, stage size, seat dimensions, etc.)
   */
  private drawMeasurements(): void {
    if (!this.layout) return

    const theme = this.colors[this.renderOptions.theme || 'light']
    const padding = 10
    const lineHeight = 16
    const fontSize = 11

    // Prepare measurement lines
    let lines: string[] = []
    lines.push(`📐 Measurements`)
    // Get first seat for dimensions
    const firstSeat = this.layout.seats[0]
    if (firstSeat) {
      lines.push(`• Seat: ${firstSeat.dimension.width.toFixed(2)}m × ${firstSeat.dimension.depth.toFixed(2)}m`)
    }
    // Show aisles from configured width only (horizontal/vertical thickness)
    const aisleWidth = this.layout.config?.aisles?.width
    const aisleCount = (this.layout.config?.aisles?.horizontal || 0) + (this.layout.config?.aisles?.vertical || 0)
    if (aisleWidth && aisleWidth > 0 && aisleCount > 0) {
      lines.push(`• Aisle: ${aisleWidth.toFixed(2)}m (${aisleCount} configured)`)
    }

    for (const zone of this.layout.zones) {
      if (zone.type === ZoneType.AISLE) continue
      const width = zone.bounds.maxX - zone.bounds.minX
      const height = zone.bounds.maxY - zone.bounds.minY
      const zoneLabel = zone.label || zone.type || 'Zone'
      lines.push(`• ${zoneLabel}: ${width.toFixed(1)}m × ${height.toFixed(1)}m`)
    }

    // Calculate box size
    const boxWidth = 240
    const boxHeight = lines.length * lineHeight + padding
    const x = this.canvas.width - boxWidth - padding
    const y = padding

    // Draw background
    this.ctx.fillStyle = theme.background
    this.ctx.globalAlpha = 0.92
    this.ctx.fillRect(x, y, boxWidth, boxHeight)
    // Border
    this.ctx.strokeStyle = theme.border
    this.ctx.lineWidth = 2
    this.ctx.globalAlpha = 1
    this.ctx.strokeRect(x, y, boxWidth, boxHeight)

    // Draw text
    this.ctx.fillStyle = theme.text
    this.ctx.font = `${fontSize}px monospace`
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'top'
    this.ctx.globalAlpha = 1
    for (let i = 0; i < lines.length; i++) {
      this.ctx.fillText(lines[i], x + 10, y + 8 + i * lineHeight)
    }
  }

  private drawLayoutAlert(): void {
    if (!this.layoutAlert) return

    const theme = this.colors[this.renderOptions.theme || 'light']
    const title = this.layoutAlert.title
    this.ctx.save()
    this.ctx.font = '12px sans-serif'
    const maxTextWidth = Math.min(316, this.canvas.width - 48)
    const lines = [
      ...this.wrapCanvasText(this.layoutAlert.message, maxTextWidth),
      ...(this.layoutAlert.tips || []).flatMap(tip => this.wrapCanvasText(`- ${tip}`, maxTextWidth))
    ]
    const padding = 12
    const lineHeight = 17
    const titleHeight = 20
    const boxWidth = maxTextWidth + padding * 2
    const boxHeight = padding * 2 + titleHeight + lines.length * lineHeight
    const x = 12
    const y = this.canvas.height - boxHeight - 12

    this.ctx.fillStyle = '#fff7ed'
    this.ctx.globalAlpha = 0.96
    this.ctx.fillRect(x, y, boxWidth, boxHeight)

    this.ctx.strokeStyle = '#f97316'
    this.ctx.lineWidth = 2
    this.ctx.globalAlpha = 1
    this.ctx.strokeRect(x, y, boxWidth, boxHeight)

    this.ctx.fillStyle = '#9a3412'
    this.ctx.font = 'bold 13px sans-serif'
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'top'
    this.ctx.fillText(title, x + padding, y + padding)

    this.ctx.fillStyle = theme.text
    this.ctx.font = '12px sans-serif'

    lines.forEach((line, index) => {
      this.ctx.fillText(line, x + padding, y + padding + titleHeight + index * lineHeight)
    })

    this.ctx.restore()
  }

  private drawLegend(): void {
    const theme = this.colors[this.renderOptions.theme || 'light']
    const items = [
      { color: '#3b82f6', label: 'Empty Seat' },
      { color: '#10b981', label: 'Occupied Seat' },
      { color: theme.zone.stage, label: 'Stage' },
      { color: theme.zone.bleacher, label: 'Bleacher Zone' },
      { color: '#ededed', label: 'Aisle' }
    ]

    const padding = 12
    const lineHeight = 18
    const swatchSize = 12
    const boxWidth = 170
    const boxHeight = padding * 2 + 18 + items.length * lineHeight
    const x = this.canvas.width - boxWidth - 12
    const y = this.canvas.height - boxHeight - 12

    this.ctx.save()
    this.ctx.fillStyle = theme.background
    this.ctx.globalAlpha = 0.94
    this.ctx.fillRect(x, y, boxWidth, boxHeight)

    this.ctx.strokeStyle = theme.border
    this.ctx.lineWidth = 2
    this.ctx.globalAlpha = 1
    this.ctx.strokeRect(x, y, boxWidth, boxHeight)

    this.ctx.fillStyle = theme.text
    this.ctx.font = 'bold 13px sans-serif'
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'top'
    this.ctx.fillText('Legend', x + padding, y + padding)

    this.ctx.font = '12px sans-serif'
    items.forEach((item, index) => {
      const rowY = y + padding + 22 + index * lineHeight
      this.ctx.fillStyle = item.color
      this.ctx.fillRect(x + padding, rowY + 2, swatchSize, swatchSize)
      this.ctx.strokeStyle = 'rgba(0,0,0,0.15)'
      this.ctx.lineWidth = 1
      this.ctx.strokeRect(x + padding, rowY + 2, swatchSize, swatchSize)

      this.ctx.fillStyle = theme.text
      this.ctx.fillText(item.label, x + padding + swatchSize + 8, rowY)
    })

    this.ctx.restore()
  }

  private wrapCanvasText(text: string, maxWidth: number): string[] {
    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word
      if (this.ctx.measureText(nextLine).width <= maxWidth || !currentLine) {
        currentLine = nextLine
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines
  }

  /**
   * Draw placeholder when no layout is loaded
   */
  private drawPlaceholder(): void {
    const theme = this.colors[this.renderOptions.theme || 'light']
    const boxWidth = Math.min(360, this.canvas.width - 40)
    const boxHeight = 92
    const x = (this.canvas.width - boxWidth) / 2
    const y = (this.canvas.height - boxHeight) / 2

    this.ctx.save()
    this.ctx.fillStyle = theme.background
    this.ctx.globalAlpha = 0.94
    this.ctx.fillRect(x, y, boxWidth, boxHeight)

    this.ctx.strokeStyle = theme.border
    this.ctx.lineWidth = 2
    this.ctx.globalAlpha = 1
    this.ctx.strokeRect(x, y, boxWidth, boxHeight)

    this.ctx.fillStyle = theme.text
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.font = 'bold 16px sans-serif'
    this.ctx.fillText('No layout loaded', this.canvas.width / 2, y + 30)
    this.ctx.font = '12px sans-serif'
    this.ctx.fillText('Adjust the controls, then click Generate Layout to render the seating plan.', this.canvas.width / 2, y + 57)
    this.ctx.restore()
  }

  private drawEmptyLayoutMessage(): void {
    const theme = this.colors[this.renderOptions.theme || 'light']
    const boxWidth = Math.min(340, this.canvas.width - 40)
    const boxHeight = 86
    const x = (this.canvas.width - boxWidth) / 2
    const y = (this.canvas.height - boxHeight) / 2

    this.ctx.save()
    this.ctx.fillStyle = theme.background
    this.ctx.globalAlpha = 0.94
    this.ctx.fillRect(x, y, boxWidth, boxHeight)

    this.ctx.strokeStyle = theme.border
    this.ctx.lineWidth = 2
    this.ctx.globalAlpha = 1
    this.ctx.strokeRect(x, y, boxWidth, boxHeight)

    this.ctx.fillStyle = theme.text
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.font = 'bold 16px sans-serif'
    this.ctx.fillText('No seats fit in this layout', this.canvas.width / 2, y + 28)
    this.ctx.font = '12px sans-serif'
    this.ctx.fillText('Try reducing seat size or spacing, or increase the available floor area.', this.canvas.width / 2, y + 54)
    this.ctx.restore()
  }

  /**
   * Update render options
   */
  setRenderOptions(options: Partial<RenderOptions>): void {
    this.renderOptions = { ...this.renderOptions, ...options }
    if (this.layout) {
      this.render()
    }
  }

  /**
   * Zoom in/out
   */
  zoom(factor: number): void {
    this.renderContext.scale *= factor
    if (this.layout) {
      this.render()
    }
  }

  /**
   * Pan the view
   */
  pan(deltaX: number, deltaY: number): void {
    this.renderContext.offsetX += deltaX
    this.renderContext.offsetY += deltaY
    if (this.layout) {
      this.render()
    }
  }

  /**
   * Reset view to fit layout
   */
  resetView(): void {
    if (this.layout) {
      this.fitLayoutInView()
      this.render()
    }
  }

  /**
   * Export layout as JSON
   */
  exportJSON(): string {
    if (!this.layout) {
      throw new Error('No layout loaded')
    }
    return JSON.stringify(this.layout, null, 2)
  }
}

export function createRenderer(
  canvasElement: HTMLCanvasElement,
  options?: Partial<RenderOptions>
): Canvas2DRenderer {
  return new Canvas2DRenderer(canvasElement, options)
}
