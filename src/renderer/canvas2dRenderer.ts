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
  private isExporting = false
  // Computed comfort rooms and clearance corridors (in meters) used to remove seats
  private comfortRooms: Array<{ minX: number; minY: number; maxX: number; maxY: number; label: string }> = []
  private clearanceCorridors: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = []

  // Theme colors
  private colors = {
    light: {
      background: '#ffffff',
      grid: '#e0e0e0',
      seat: '#3b82f6',
      seatAccessible: '#10b981',
      seatVip: '#f59e0b',
      seatBleacher: '#fb923c',
      seatBleacher1: '#f97316',
      seatBleacher2: '#8b5cf6',
      zone: {
        stage: '#efad44',
        vip: '#f59e0b',
        blocked: '#9ca3af',
        emergency: '#06b6d4',
        aisle: '#f3f4f6',
        bleacher: '#fdba74',
        medical: '#ec4899',
        photobooth: '#8b5cf6'
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
      seatBleacher1: '#fb923c',
      seatBleacher2: '#a78bfa',
      zone: {
        stage: '#f87171',
        vip: '#fcd34d',
        blocked: '#6b7280',
        emergency: '#06b6d4',
        aisle: '#111827',
        bleacher: '#f59e0b',
        medical: '#f472b6',
        photobooth: '#a78bfa'
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
      showSeatNumbers: false,
      showZones: true,
      showAisles: true,
      highlightAccessible: true,
      showLegend: true,
      showWarnings: true,
      showMeasurements: true,
      hideEmptySeats: false,
      theme: 'light',
      comfortRoomWidthMeters: undefined,
      comfortRoomHeightMeters: undefined,
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
  private fitLayoutInView(centerInViewport = false): void {
    if (!this.layout) return

    const padding = 50 // pixels

    // Find bounds of all seats and zones
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    // Check seats
    const seatsToConsider = this.renderOptions.hideEmptySeats
      ? this.layout.seats.filter(s => s.metadata.occupied)
      : this.layout.seats

    for (const seat of seatsToConsider) {
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

    // Fallback if no seats are visible
    if (minX === Infinity) {
        minX = 0; maxX = this.layout.config?.width || 20;
        minY = 0; maxY = this.layout.config?.length || 15;
    }

    const width = maxX - minX
    const height = maxY - minY

    const availableWidth = this.renderContext.width - 2 * padding
    const availableHeight = this.renderContext.height - 2 * padding

    const scaleX = availableWidth / width
    const scaleY = availableHeight / height

    this.renderContext.scale = Math.min(scaleX, scaleY, 50) // Cap at 50 px/m

    if (centerInViewport) {
      const renderedWidth = width * this.renderContext.scale
      const renderedHeight = height * this.renderContext.scale
      this.renderContext.offsetX =
        (this.renderContext.width - renderedWidth) / 2 - minX * this.renderContext.scale
      this.renderContext.offsetY =
        (this.renderContext.height - renderedHeight) / 2 - minY * this.renderContext.scale
      return
    }

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

    // Compute comfort rooms and clearance corridors before drawing seats
    this.computeComfortRoomsAndCorridors()

    // Draw gym border and label before seats and overlays
    this.drawGymBorder()
    
    // Draw gym dimensions (if no stage present)
    this.drawGymDimensions()

    const theme = this.colors[this.renderOptions.theme || 'light']
    this.drawAllBleacherBands(theme)

    this.drawSeats()

    // Keep bottom elements (medical tables + photobooth) visible above bleachers/seats.
    if (this.renderOptions.showZones) {
      this.drawTopZones()
    }

    // Draw exit icons on top of everything
    this.drawExitIcons()

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

  private getStageZone() {
    return this.layout?.zones.find(zone => zone.type === ZoneType.STAGE) || null
  }

  private isExteriorStage(): boolean {
    const stage = this.getStageZone()
    return !!stage && stage.bounds.maxY <= 0
  }

  private getRectangularFootprintPoints(): Array<{ x: number; y: number }> {
    if (!this.layout?.config) return []

    const { width, length } = this.layout.config
    const stage = this.getStageZone()
    const bottomInset = Math.min(width * 0.14, 4)
    const chamferStartY = Math.max(length - Math.min(length * 0.12, 3), length * 0.82)

    if (this.isExteriorStage() && stage) {
      return [
        { x: 0, y: 0 },
        { x: stage.bounds.minX, y: 0 },
        { x: stage.bounds.minX, y: stage.bounds.minY },
        { x: stage.bounds.maxX, y: stage.bounds.minY },
        { x: stage.bounds.maxX, y: 0 },
        { x: width, y: 0 },
        { x: width, y: chamferStartY },
        { x: width - bottomInset, y: length },
        { x: bottomInset, y: length },
        { x: 0, y: chamferStartY }
      ]
    }

    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: chamferStartY },
      { x: width - bottomInset, y: length },
      { x: bottomInset, y: length },
      { x: 0, y: chamferStartY }
    ]
  }

  private buildFootprintPath(): void {
    if (!this.layout?.config) return

    if (
      this.layout.config.shape !== GymnasiumShape.RECTANGLE &&
      this.layout.config.shape !== GymnasiumShape.SQUARE
    ) {
      this.ctx.beginPath()
      this.ctx.rect(
        this.renderContext.offsetX,
        this.renderContext.offsetY,
        this.layout.config.width * this.renderContext.scale,
        this.layout.config.length * this.renderContext.scale
      )
      return
    }

    const points = this.getRectangularFootprintPoints()
    this.ctx.beginPath()
    points.forEach((point, index) => {
      const x = point.x * this.renderContext.scale + this.renderContext.offsetX
      const y = point.y * this.renderContext.scale + this.renderContext.offsetY
      if (index === 0) {
        this.ctx.moveTo(x, y)
      } else {
        this.ctx.lineTo(x, y)
      }
    })
    this.ctx.closePath()
  }

  private clipToGymFootprint(): void {
    this.buildFootprintPath()
    this.ctx.clip()
  }

  private getZoneDisplayLabel(zoneId: string, fallback?: string): string | null {
    if (zoneId.includes('clearance') || zoneId.includes('reserved')) return null

    const labels: Record<string, string> = {
      'table-left': 'Medical Team',
      'table-right': 'Medical Team',
      'emergency-left': 'Emergency Exit',
      'emergency-right': 'Emergency Exit',
      'aisle-side-left': 'Side Aisle',
      'aisle-side-right': 'Side Aisle',
      'aisle-front': 'Front Aisle',
      'aisle-back': 'Back Aisle',
      'aisle-carpet': 'Red Carpet',
      'aisle-horizontal': 'Horizontal Aisle',
      'aisle-vertical-center-left': 'Vertical Aisle',
      'aisle-vertical-center-right': 'Vertical Aisle',
      'photobooth': 'Photo Booth',
      'entrance': 'Entrance'
    }

    return labels[zoneId] || fallback || null
  }

  /**
   * Draw a red border showing the gym's size and coverage, with label and dimension text
   */
  private drawGymBorder(): void {
    if (!this.layout || !this.layout.config) return
    const config = this.layout.config
    const x1 = this.renderContext.offsetX
    const y1 = this.renderContext.offsetY
    const width = config.width * this.renderContext.scale

    this.ctx.save()
    this.ctx.strokeStyle = '#ef4444'
    this.ctx.lineWidth = 4
    this.ctx.globalAlpha = 0.85
    this.ctx.setLineDash([8, 6])
    this.buildFootprintPath()
    this.ctx.stroke()
    this.ctx.setLineDash([])
    this.ctx.globalAlpha = 1

    const hasStage = this.layout.zones?.some(z => z.type === ZoneType.STAGE)
    if (this.renderOptions.showMeasurements && !hasStage) {
      const fontSize = 16
      this.ctx.font = `bold ${fontSize}px sans-serif`
      this.ctx.fillStyle = '#ef4444'
      this.ctx.textAlign = 'left'
      this.ctx.textBaseline = 'top'
      const labelText = config.name || 'Gym'
      this.ctx.fillText(labelText, x1 + 8, y1 + 8)

      const dimFont = 14
      this.ctx.font = `${dimFont}px monospace`
      const dimText = `${config.width.toFixed(2)}m x ${config.length.toFixed(2)}m`
      this.ctx.textAlign = 'center'
      this.ctx.textBaseline = 'top'
      this.ctx.fillText(dimText, x1 + width / 2, y1 + 8)
    }

    this.ctx.restore()
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

    // Draw grid aligned to world (meter) coordinates so lines line up with seat positions.
    // Compute visible world bounds
    const worldMinX = (-this.renderContext.offsetX) / this.renderContext.scale
    const worldMaxX = (this.canvas.width - this.renderContext.offsetX) / this.renderContext.scale
    const worldMinY = (-this.renderContext.offsetY) / this.renderContext.scale
    const worldMaxY = (this.canvas.height - this.renderContext.offsetY) / this.renderContext.scale

    this.ctx.strokeStyle = theme.grid
    this.ctx.lineWidth = 0.5
    this.ctx.globalAlpha = 0.3

    // Vertical lines: iterate world coordinates and map to pixels
    const firstVX = Math.floor(worldMinX / spacing) * spacing
    for (let wx = firstVX; wx <= worldMaxX; wx += spacing) {
      const x = wx * this.renderContext.scale + this.renderContext.offsetX
      this.ctx.beginPath()
      this.ctx.moveTo(x, 0)
      this.ctx.lineTo(x, this.canvas.height)
      this.ctx.stroke()
    }

    // Horizontal lines
    const firstHY = Math.floor(worldMinY / spacing) * spacing
    for (let wy = firstHY; wy <= worldMaxY; wy += spacing) {
      const y = wy * this.renderContext.scale + this.renderContext.offsetY
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

    // Draw non-aisle zones first (skipping special zones that should be on top)
    for (const zone of this.layout.zones) {
      // Defer aisles, tables, photobooth and emergency overlays to their special renderers
      if (zone.type === ZoneType.AISLE || zone.id.includes('table') || zone.id === 'photobooth' || zone.type === ZoneType.EMERGENCY) {
        continue
      }
      // Bleachers are rendered separately (bands + bleacher seats). Drawing BLEACHER zones here
      // creates a solid orange overlay above the step bands.
      if (zone.type === ZoneType.BLEACHER) {
        continue
      }
      if (zone.id.includes('reserved')) {
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

      this.ctx.save()
      this.ctx.fillStyle = zoneColor
      this.ctx.globalAlpha = 0.3
      this.ctx.fillRect(x1, y1, width, height)

      // Draw border
      this.ctx.strokeStyle = zoneColor
      this.ctx.lineWidth = 2
      this.ctx.globalAlpha = 1
      this.ctx.strokeRect(x1, y1, width, height)
      this.ctx.restore()

      // Draw label (always show stage label; optional for others)
      const zoneLabel = this.getZoneDisplayLabel(zone.id, zone.label)
      if ((this.renderOptions.showLabels || zone.type === ZoneType.STAGE) && zoneLabel) {
        this.ctx.fillStyle = theme.text
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        // Use fit text to handle potential overflow for "Photo Booth" or other long labels
        this.drawFittingText(zoneLabel, (x1 + x2) / 2, (y1 + y2) / 2, width - 8, height - 8, 13)
      }

      // Draw dimension text
      if (
        this.renderOptions.showMeasurements &&
        !zone.id.includes('clearance') &&
        !zone.id.includes('reserved')
      ) {
        const zoneWidth = zone.bounds.maxX - zone.bounds.minX
        const zoneHeight = zone.bounds.maxY - zone.bounds.minY
        
        const dimText = `${zoneWidth.toFixed(2)}m x ${zoneHeight.toFixed(2)}m`
        
        this.ctx.save()
        this.ctx.font = 'bold 10px monospace'
        this.ctx.fillStyle = theme.text
        this.ctx.globalAlpha = 0.85
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        
        const textX = (x1 + x2) / 2
        const textY = y2 - 12
        this.ctx.fillText(dimText, textX, textY)
        this.ctx.restore()
      }
    }

    // Draw aisles last with solid fill and no transparency.
    // Important: draw the red carpet after other aisles so it doesn't get overpainted
    // (e.g., by a horizontal cross-aisle).
    const aisleZones = this.layout.zones
      .filter(z => z.type === ZoneType.AISLE)
      .sort((a, b) => {
        const aIsCarpet = a.id === 'aisle-carpet'
        const bIsCarpet = b.id === 'aisle-carpet'
        if (aIsCarpet === bIsCarpet) return 0
        return aIsCarpet ? 1 : -1 // carpet last
      })

    for (const zone of aisleZones) {

      const x1 = zone.bounds.minX * this.renderContext.scale + this.renderContext.offsetX
      const y1 = zone.bounds.minY * this.renderContext.scale + this.renderContext.offsetY
      const x2 = zone.bounds.maxX * this.renderContext.scale + this.renderContext.offsetX
      const y2 = zone.bounds.maxY * this.renderContext.scale + this.renderContext.offsetY

      const isCarpet = zone.id === 'aisle-carpet'
      this.ctx.save()
      this.clipToGymFootprint()
      this.ctx.fillStyle = isCarpet ? '#b91c1c' : '#ededed'
      this.ctx.globalAlpha = 1
      this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1)

      this.ctx.strokeStyle = isCarpet ? '#7f1d1d' : '#999999'
      this.ctx.lineWidth = 1
      this.ctx.globalAlpha = 1
      this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)

      if (this.renderOptions.showLabels) {
        const aisleLabel = this.getZoneDisplayLabel(zone.id, zone.label)
        if (aisleLabel) {
          this.ctx.fillStyle = isCarpet ? '#fff7ed' : theme.text

          // Side aisle + red carpet + vertical center aisles: render vertically (top-to-bottom).
          if (
            zone.id === 'aisle-side-left' ||
            zone.id === 'aisle-side-right' ||
            zone.id === 'aisle-carpet' ||
            zone.id === 'aisle-vertical-center-left' ||
            zone.id === 'aisle-vertical-center-right'
          ) {
            this.ctx.save()
            this.ctx.font = 'bold 11px sans-serif'
            this.ctx.textBaseline = 'middle'
            const cx = (x1 + x2) / 2

            // New logic: Only aisle-vertical-center labels start from top. Side and Carpet remain centered.
            const isCenterVertical = zone.id === 'aisle-vertical-center-left' || zone.id === 'aisle-vertical-center-right'
            const cy = isCenterVertical ? y1 + 15 : (y1 + y2) / 2

            this.ctx.translate(cx, cy)
            this.ctx.rotate(Math.PI / 2)
            this.ctx.textAlign = isCenterVertical ? 'left' : 'center'
            this.ctx.fillText(aisleLabel, 0, 0)
            this.ctx.restore()
          } else if (zone.id === 'aisle-horizontal') {
            // Horizontal aisle label: small, upper-left corner.
            this.ctx.font = 'bold 9px sans-serif'
            this.ctx.textAlign = 'left'
            this.ctx.textBaseline = 'top'
            this.ctx.fillText(aisleLabel, x1 + 4, y1 + 4)
          } else {
            this.ctx.font = 'bold 11px sans-serif'
            this.ctx.textAlign = 'center'
            this.ctx.textBaseline = 'middle'
            this.ctx.fillText(aisleLabel, (x1 + x2) / 2, (y1 + y2) / 2)
          }
        }
      }

      this.ctx.restore()
    }

  }

  private drawTopZones(): void {
    if (!this.layout) return

    const theme = this.colors[this.renderOptions.theme || 'light']

    // Draw special zones (Medical tables and Photobooth) on top of everything else
    for (const zone of this.layout.zones) {
      // Handle tables, photobooth, and emergency overlays here so they render above bleachers/seats
      if (!zone.id.includes('table') && zone.id !== 'photobooth' && zone.type !== ZoneType.EMERGENCY) {
        continue
      }
      if (zone.id.includes('reserved')) {
        continue
      }

      const x1 = zone.bounds.minX * this.renderContext.scale + this.renderContext.offsetX
      const y1 = zone.bounds.minY * this.renderContext.scale + this.renderContext.offsetY
      const x2 = zone.bounds.maxX * this.renderContext.scale + this.renderContext.offsetX
      const y2 = zone.bounds.maxY * this.renderContext.scale + this.renderContext.offsetY

      const width = x2 - x1
      const height = y2 - y1

      let zoneColor = (theme.zone as any).medical
      let alpha = 0.92
      if (zone.id === 'photobooth') {
        zoneColor = (theme.zone as any).photobooth
        alpha = 0.92
      }
      if (zone.type === ZoneType.EMERGENCY) {
        // Emergency exit is rendered as a physical gap; visual Comfort Rooms
        // are drawn once after the zone loop (see bottom of this function).
      } else {
        this.ctx.fillStyle = zoneColor
        this.ctx.globalAlpha = alpha
        this.ctx.fillRect(x1, y1, width, height)
        this.ctx.strokeStyle = theme.text
        this.ctx.lineWidth = 2
        this.ctx.globalAlpha = 1
        this.ctx.strokeRect(x1, y1, width, height)
      }

      const zoneLabel = this.getZoneDisplayLabel(zone.id, zone.label)
      // Do not draw a label for emergency gaps themselves (the comfort rooms are labeled separately)
      if (zone.type !== ZoneType.EMERGENCY && this.renderOptions.showLabels && zoneLabel) {
        this.ctx.fillStyle = theme.text
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        this.drawFittingText(zoneLabel, (x1 + x2) / 2, (y1 + y2) / 2, width - 8, height - 8, 13)
      }

      this.ctx.restore()
    }
    // Draw computed comfort rooms once (they were computed earlier)
    if (this.comfortRooms.length > 0) {
      // First pass: Draw all boxes
      for (const cr of this.comfortRooms) {
        const cx1 = cr.minX * this.renderContext.scale + this.renderContext.offsetX
        const cy1 = cr.minY * this.renderContext.scale + this.renderContext.offsetY
        const cx2 = cr.maxX * this.renderContext.scale + this.renderContext.offsetX
        const cy2 = cr.maxY * this.renderContext.scale + this.renderContext.offsetY
        const cw = cx2 - cx1
        const ch = cy2 - cy1

        this.ctx.save()
        const crFill = (theme.zone as any).medical
        const crBorder = (theme.zone as any).medical
        this.ctx.fillStyle = crFill
        this.ctx.globalAlpha = 0.75
        this.ctx.fillRect(cx1, cy1, cw, ch)
        this.ctx.globalAlpha = 1
        this.ctx.strokeStyle = crBorder
        this.ctx.lineWidth = 2
        this.ctx.strokeRect(cx1, cy1, cw, ch)
        this.ctx.restore()
      }

      // Second pass: Draw labels on top of all boxes
      if (this.renderOptions.showLabels) {
        for (const cr of this.comfortRooms) {
          if (!cr.label) continue

          const cx1 = cr.minX * this.renderContext.scale + this.renderContext.offsetX
          const cy1 = cr.minY * this.renderContext.scale + this.renderContext.offsetY
          const cx2 = cr.maxX * this.renderContext.scale + this.renderContext.offsetX
          const cy2 = cr.maxY * this.renderContext.scale + this.renderContext.offsetY
          const cw = cx2 - cx1
          const ch = cy2 - cy1

          this.ctx.save()
          const crFill = (theme.zone as any).medical
          this.ctx.fillStyle = theme.text
          this.ctx.font = 'bold 12px sans-serif'
          this.ctx.textAlign = 'center'
          this.ctx.textBaseline = 'middle'

          let textX = cx1 + cw / 2
          if (cr.label === 'Female CR' || cr.label === 'Male CR') {
            // Center the label across the combined width of the CR and PWD zones.
            // Since they are split exactly in half, the midpoint is at the boundary (cx1 + cw).
            textX = cx1 + cw

            // Clear a small area behind the centered text so the separator line doesn't cut through it
            const textWidth = this.ctx.measureText(cr.label).width
            this.ctx.save()
            this.ctx.fillStyle = crFill
            this.ctx.globalAlpha = 1
            this.ctx.fillRect(textX - textWidth / 2 - 2, cy1 + ch / 2 - 8, textWidth + 4, 16)
            this.ctx.restore()
          }

          this.ctx.fillText(cr.label, textX, cy1 + ch / 2)
          this.ctx.restore()
        }
      }
    }
  }

  /**
   * Draw text that fits within a box by shrinking and wrapping
   */
  private drawFittingText(text: string, centerX: number, centerY: number, maxWidth: number, maxHeight: number, baseFontSize = 13): void {
    let fontSize = baseFontSize
    this.ctx.font = `bold ${fontSize}px sans-serif`

    // Initial wrap check
    let lines = this.wrapCanvasText(text, maxWidth)

    // If it's too wide (e.g. single long word) or too tall, shrink font
    while (fontSize > 7) {
      this.ctx.font = `bold ${fontSize}px sans-serif`
      lines = this.wrapCanvasText(text, maxWidth)
      const totalHeight = lines.length * (fontSize * 1.2)

      const fitsWidth = lines.every(line => this.ctx.measureText(line).width <= maxWidth)
      if (fitsWidth && totalHeight <= maxHeight) {
        break
      }
      fontSize -= 0.5
    }

    const lineHeight = fontSize * 1.2
    const totalHeight = lines.length * lineHeight
    const startY = centerY - (totalHeight / 2) + (fontSize / 2)

    lines.forEach((line, i) => {
      this.ctx.fillText(line, centerX, startY + i * lineHeight)
    })
  }

  /**
   * Compute comfort room rectangles (in meters) and clearance corridors connecting them to nearest aisles.
   * This must run before seat drawing so seats can be omitted in these areas.
   */
  private computeComfortRoomsAndCorridors(): void {
    this.comfortRooms = []
    this.clearanceCorridors = []
    if (!this.layout) return

    const aisles = this.layout.zones.filter(z => z.type === ZoneType.AISLE)
    const emergencies = this.layout.zones.filter(z => z.type === ZoneType.EMERGENCY)

    for (const ez of emergencies) {
      const zoneW = ez.bounds.maxX - ez.bounds.minX
      const zoneH = ez.bounds.maxY - ez.bounds.minY

      // Determine CR dimensions (meters)
      const crW = this.renderOptions.comfortRoomWidthMeters && this.renderOptions.comfortRoomWidthMeters > 0
        ? Math.min(this.renderOptions.comfortRoomWidthMeters, Math.max(0.1, zoneW - 0.1))
        : Math.max(0.25 * zoneW, zoneW - 0.2)

      const crH = this.renderOptions.comfortRoomHeightMeters && this.renderOptions.comfortRoomHeightMeters > 0
        ? Math.min(this.renderOptions.comfortRoomHeightMeters, Math.max(0.1, zoneH - 0.1))
        : Math.max(0.2 * zoneH, Math.min(zoneH / 2 - 0.1, zoneH - 0.2))

      // Place CRs at the extreme top and bottom inside emergency gap
      const centerX = (ez.bounds.minX + ez.bounds.maxX) / 2
      const crMinX = Math.max(ez.bounds.minX + 0.05, centerX - crW / 2)
      const crMaxX = Math.min(ez.bounds.maxX - 0.05, centerX + crW / 2)
      const midX = (crMinX + crMaxX) / 2

      const padding = 0.05

      // Skip CR creation for emergency exits marked as 'no-cr' (upper stage exits)
      if (!ez.id.includes('no-cr')) {
        // Top section split into CR and PWD
        const topMinY = ez.bounds.minY + padding
        const topMaxY = Math.min(ez.bounds.minY + padding + crH, ez.bounds.maxY - padding)

        this.comfortRooms.push(
          { minX: crMinX, minY: topMinY, maxX: midX, maxY: topMaxY, label: 'Female CR' },
          { minX: midX, minY: topMinY, maxX: crMaxX, maxY: topMaxY, label: '' }
        )

        // Bottom section split into CR and PWD
        const bottomMaxY = ez.bounds.maxY - padding
        const bottomMinY = Math.max(ez.bounds.maxY - padding - crH, ez.bounds.minY + padding)

        this.comfortRooms.push(
          { minX: crMinX, minY: bottomMinY, maxX: midX, maxY: bottomMaxY, label: 'Male CR' },
          { minX: midX, minY: bottomMinY, maxX: crMaxX, maxY: bottomMaxY, label: '' }
        )
      }

      // For each comfort room find nearest aisle and create a clearance corridor
      // If no CRs were added for this exit (e.g. no-cr exit), we still create a
      // clearance corridor from the exit zone itself to ensure it leads somewhere.
      const roomsToProcess = ez.id.includes('no-cr') ? [{ minX: crMinX, minY: ez.bounds.minY, maxX: crMaxX, maxY: ez.bounds.maxY }] : this.comfortRooms.slice(-4)

      for (const cr of (roomsToProcess as any[])) {
        let bestAisle: any = null
        let bestDist = Infinity
        for (const a of aisles) {
          const dist = this.rectsDistance(cr, a.bounds)
          if (dist < bestDist) {
            bestDist = dist
            bestAisle = a
          }
        }

        // If no aisle found, connect to nearest gym edge to guarantee a clear path
        let aisleBounds = bestAisle ? bestAisle.bounds : null
        if (!aisleBounds && this.layout?.config) {
          const gymW = this.layout.config.width
          const crCenterX = (cr.minX + cr.maxX) / 2
          // connect horizontally to left or right edge depending on CR position
          if (crCenterX < gymW / 2) {
            aisleBounds = { minX: 0, minY: 0, maxX: 0, maxY: this.layout.config.length }
          } else {
            aisleBounds = { minX: this.layout.config.width, minY: 0, maxX: this.layout.config.width, maxY: this.layout.config.length }
          }
        }

        if (!aisleBounds) continue

        // Compute corridor as minimal axis-aligned rectangle connecting CR and aisle
        const corridor = this.computeAxisAlignedCorridor(cr, aisleBounds)
        // Expand for robust clearance (approx typical aisle width)
        const expand = 0.85
        corridor.minX = Math.max(0, corridor.minX - expand)
        corridor.minY = Math.max(0, corridor.minY - expand)
        corridor.maxX = Math.min(this.layout.config?.width || corridor.maxX, corridor.maxX + expand)
        corridor.maxY = Math.min(this.layout.config?.length || corridor.maxY, corridor.maxY + expand)

        this.clearanceCorridors.push(corridor)
      }
    }
  }

  private computeAxisAlignedCorridor(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) {
    // If horizontally overlapping, create vertical corridor
    if (b.minX <= a.maxX && b.maxX >= a.minX) {
      return {
        minX: Math.max(a.minX, b.minX),
        maxX: Math.min(a.maxX, b.maxX),
        minY: Math.min(a.minY, b.minY),
        maxY: Math.max(a.maxY, b.maxY)
      }
    }
    // If vertically overlapping, create horizontal corridor
    if (b.minY <= a.maxY && b.maxY >= a.minY) {
      return {
        minX: Math.min(a.minX, b.minX),
        maxX: Math.max(a.maxX, b.maxX),
        minY: Math.max(a.minY, b.minY),
        maxY: Math.min(a.maxY, b.maxY)
      }
    }

    // Otherwise return bounding box between the two
    return {
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY)
    }
  }

  private rectsDistance(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) {
    const dx = Math.max(0, Math.max(b.minX - a.maxX, a.minX - b.maxX))
    const dy = Math.max(0, Math.max(b.minY - a.maxY, a.minY - b.maxY))
    return Math.sqrt(dx * dx + dy * dy)
  }

  private isSeatInClearance(seat: Seat) {
    // Only VIP/faculty seats should be removed/omitted to ensure emergency exits and
    // comfort-room clearance — ordinary seats should not be deleted for this reason.
    if (!this.layout) return false
    if (!seat.metadata || !seat.metadata.vip) return false

    const x = seat.position.x
    const y = seat.position.y
    // Emergency zones
    for (const ez of this.layout.zones.filter(z => z.type === ZoneType.EMERGENCY)) {
      if (x >= ez.bounds.minX - 1e-6 && x <= ez.bounds.maxX + 1e-6 && y >= ez.bounds.minY - 1e-6 && y <= ez.bounds.maxY + 1e-6) return true
    }
    // Clearance corridors
    for (const c of this.clearanceCorridors) {
      if (x >= c.minX - 1e-6 && x <= c.maxX + 1e-6 && y >= c.minY - 1e-6 && y <= c.maxY + 1e-6) return true
    }
    return false
  }

  /**
   * Draw gym dimensions with label and measurements
   */
  private drawGymDimensions(): void {
    if (!this.layout || !this.layout.config || !this.renderOptions.showMeasurements) return
    
    // const config = this.layout.config
    // const theme = this.colors[this.renderOptions.theme || 'light']
    
    // // Use full gym dimensions, not usable area
    // const x1 = this.renderContext.offsetX
    // const y1 = this.renderContext.offsetY
    
    this.ctx.save()
    
    // Gym label and dimensions at top-left corner
    // const fontSize = 12
    // this.ctx.font = `bold ${fontSize}px sans-serif`
    // this.ctx.fillStyle = theme.text
    // this.ctx.globalAlpha = 0.7
    // this.ctx.textAlign = 'left'
    // this.ctx.textBaseline = 'top'
    // this.ctx.fillText('Gym', x1 + 8, y1 + 8)
    
    // // Gym dimensions below label (full gym, not usable area)
    // const dimText = `${config.width.toFixed(2)}m x ${config.length.toFixed(2)}m`
    // this.ctx.font = 'bold 10px monospace'
    // this.ctx.fillText(dimText, x1 + 8, y1 + 22)
    
    this.ctx.restore()
  }

  /**
   * Draw seats
   */
  private drawSeats(): void {
    if (!this.layout) return

    const theme = this.colors[this.renderOptions.theme || 'light']
    const bleacherRows = new Map<number, Seat[]>()

    for (const seat of this.layout.seats) {
      if (this.renderOptions.hideEmptySeats && !seat.metadata.occupied) {
        continue
      }

      // Skip seats that are inside emergency gaps or clearance corridors
      if (this.isSeatInClearance(seat)) {
        continue
      }

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
      // VIP seats use the VIP color
      let color = seat.metadata.occupied ? '#10b981' : '#3b82f6'
      if (seat.metadata.vip) {
        color = theme.seatVip
      }
      // Draw seat rectangle
      this.ctx.fillStyle = color
      this.ctx.globalAlpha = seat.metadata.blocked ? 0.3 : 1

      this.ctx.fillRect(x - width / 2, y - height / 2, width, height)
      // Draw border
      this.ctx.strokeStyle = 'rgba(0,0,0,0.2)'
      this.ctx.lineWidth = 1
      this.ctx.globalAlpha = 1
      this.ctx.strokeRect(x - width / 2, y - height / 2, width, height)

      // Draw seat number. During export force the smallest readable font so
      // numbers are present on the exported image even when markers end up small.
      if (this.renderOptions.showSeatNumbers && seat.metadata.seatNumber) {
        this.ctx.fillStyle = 'white'
        if (this.isExporting) {
          this.ctx.font = '6px sans-serif'
        } else {
          this.ctx.font = `bold ${Math.max(8, Math.min(width * 0.45, height * 0.7, 14))}px sans-serif`
        }
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        this.ctx.fillText(seat.metadata.seatNumber, x, y)
      }
    }

    bleacherRows.forEach(rowSeats => this.drawBleacherRow(rowSeats, theme))

    this.ctx.globalAlpha = 1
  }

  private getBleacherDepth(): number {
    if (!this.layout?.config?.bleachers) return 0
    
    const config = this.layout.config.bleachers
    const seatType = this.layout.config.seatTypes[0]
    const minStepDepth = seatType ? seatType.depth + 0.1 : 0.6
    const totalSteps = config.numberOfSteps + 1
    const minRequiredWidth = totalSteps * minStepDepth
    
    return Math.max(config.width, minRequiredWidth)
  }

  private drawBleacherRow(rowSeats: Seat[], theme: (typeof this.colors)['light']): void {
    if (rowSeats.length === 0 || !this.layout?.config?.bleachers) return

    const scale = this.renderContext.scale
    const totalPhysicalSteps = this.layout.config.bleachers.numberOfSteps + 1
    const bleacherDepth = this.getBleacherDepth()
    const stepDepth = (bleacherDepth / Math.max(totalPhysicalSteps, 1)) * scale
    const orderedSeats = this.orderBleacherRowSeats(rowSeats)

    this.ctx.save()
    // Keep bleacher visuals (bands + seats) inside the gym footprint (chamfered corners).
    this.clipToGymFootprint()
    
    // Band rendering is now handled by drawAllBleacherBands
    if (
      this.layout.config.shape !== GymnasiumShape.RECTANGLE &&
      this.layout.config.shape !== GymnasiumShape.SQUARE
    ) {
      this.drawConnectedBleacherPath(orderedSeats, stepDepth, theme)
    }

    for (const seat of orderedSeats) {
      // Do not draw bleacher seats that fall inside emergency exit zones or clearance corridors
      if (this.isSeatInClearance(seat)) continue

      // Determine color based on bleacher type.
      // Bleacher colors are independent of occupancy (bleachers have their own meaning/colors).
      let color = theme.seatBleacher1 || '#f97316'
      if (seat.metadata.bleacherType === 2) {
        color = theme.seatBleacher2 || '#8b5cf6'
      }

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

      if (this.renderOptions.showSeatNumbers && seat.metadata.seatNumber) {
        this.ctx.fillStyle = 'white'
        if (this.isExporting) {
          this.ctx.font = '6px sans-serif'
        } else {
          this.ctx.font = `bold ${Math.max(8, Math.min(markerWidth * 0.38, markerHeight * 0.7, 12))}px sans-serif`
        }
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        this.ctx.fillText(seat.metadata.seatNumber, markerX + markerWidth / 2, markerY + markerHeight / 2)
      }
    }

    this.ctx.restore()
  }

  private drawAllBleacherBands(theme: (typeof this.colors)['light']): void {
    if (!this.layout?.config?.bleachers) return
    
    if (
      this.layout.config.shape === GymnasiumShape.RECTANGLE ||
      this.layout.config.shape === GymnasiumShape.SQUARE
    ) {
      const totalPhysicalSteps = this.layout.config.bleachers.numberOfSteps + 1
      for (let i = 0; i < totalPhysicalSteps; i++) {
        this.drawRectangularBleacherBand(i, theme)
      }
    }
    // Note: Oval/Circle connected paths still depend on seat rows for geometry
  }

  private drawRectangularBleacherBand(stepIndex: number, theme: (typeof this.colors)['light']): void {
    if (!this.layout?.config?.bleachers) return

    const scale = this.renderContext.scale
    const totalPhysicalSteps = this.layout.config.bleachers.numberOfSteps + 1
    const bleacherDepth = this.getBleacherDepth()
    const stepDepth = bleacherDepth / Math.max(totalPhysicalSteps, 1)
    
    const outerMinX = this.layout.config.minMargin
    const outerMaxX = this.layout.config.width - this.layout.config.minMargin
    const outerMaxY = this.layout.config.length - this.layout.config.minMargin
    const minX = this.layout.config.minMargin + stepIndex * stepDepth
    const maxX = this.layout.config.width - this.layout.config.minMargin - stepIndex * stepDepth
    const maxY = this.layout.config.length - this.layout.config.minMargin - stepIndex * stepDepth
    const stage = this.layout.zones.find(zone => zone.type === ZoneType.STAGE)
    const stageMaxY = stage ? stage.bounds.maxY : this.layout.config.minMargin
    const bandThickness = stepDepth
    const requestedEntranceWidth = Number.isFinite(this.layout.config.bleachers.entranceWidth)
      ? this.layout.config.bleachers.entranceWidth
      : 2.5
    const entranceWidth = Math.min(
      Math.max(requestedEntranceWidth, 0),
      Math.max(0, outerMaxX - outerMinX - 0.2)
    )
    const entranceStart = (this.layout.config.width - entranceWidth) / 2
    const entranceEnd = entranceStart + entranceWidth

    const aisleCount = Math.max(0, Math.floor(this.layout.config.bleachers.aisleCount || 0))
    const requestedAisleWidth = Number.isFinite(this.layout.config.bleachers.aisleWidth as number)
      ? (this.layout.config.bleachers.aisleWidth as number)
      : 0
    const seatWidth = this.layout.config.seatTypes?.[0]?.width ?? 0.5
    const halfSeat = seatWidth / 2
    const defaultAisleWidth = seatWidth + this.layout.config.horizontalSpacing
    const aisleWidth = Math.max(0, requestedAisleWidth || defaultAisleWidth)
    const sideAisleCenters = (() => {
      if (aisleCount <= 0) return [] as number[]
      const spanMinY = stageMaxY + halfSeat
      const spanMaxY = outerMaxY - halfSeat
      const usable = Math.max(0, spanMaxY - spanMinY)
      if (usable <= 0.2) return [] as number[]
      return Array.from({ length: aisleCount }, (_, i) => spanMinY + (usable * (i + 1)) / (aisleCount + 1))
    })()
    const bottomAisleCenters = (() => {
      const result = { left: [] as number[], right: [] as number[] }
      if (aisleCount <= 0) return result

      const leftCount = Math.ceil(aisleCount / 2)
      const rightCount = Math.floor(aisleCount / 2)

      const leftMinX = outerMinX + halfSeat
      const leftMaxX = entranceStart - halfSeat
      const leftUsable = Math.max(0, leftMaxX - leftMinX)
      if (leftCount > 0 && leftUsable > 0.2) {
        result.left = Array.from(
          { length: leftCount },
          (_, i) => leftMinX + (leftUsable * (i + 1)) / (leftCount + 1)
        )
      }

      const rightMinX = entranceEnd + halfSeat
      const rightMaxX = outerMaxX - halfSeat
      const rightUsable = Math.max(0, rightMaxX - rightMinX)
      if (rightCount > 0 && rightUsable > 0.2) {
        result.right = Array.from(
          { length: rightCount },
          (_, i) => rightMinX + (rightUsable * (i + 1)) / (rightCount + 1)
        )
      }

      return result
    })()

    const segments = [
      // Side bands are drawn for every step.
      { x: minX, y: stageMaxY, width: bandThickness, height: Math.max(0, maxY - stageMaxY) },
      { x: maxX - bandThickness, y: stageMaxY, width: bandThickness, height: Math.max(0, maxY - stageMaxY) }
    ]

    // Bottom band is drawn for every step to represent the bleacher steps.
    segments.push(
      { x: minX, y: maxY - bandThickness, width: Math.max(0, entranceStart - minX), height: bandThickness },
      { x: entranceEnd, y: maxY - bandThickness, width: Math.max(0, maxX - entranceEnd), height: bandThickness }
    )

    // Make sure bleacher visuals respect the gym footprint (chamfered rectangle).
    this.ctx.save()
    this.clipToGymFootprint()

    this.ctx.fillStyle = theme.zone.bleacher
    this.ctx.globalAlpha = 0.55
    this.ctx.strokeStyle = theme.seatBleacher
    this.ctx.lineWidth = 2

    for (const segment of segments) {
      if (segment.width <= 0 || segment.height <= 0) continue

      // Carve bleacher aisles (walking gaps) out of the bleacher band.
      // Side bands: split along Y. Bottom bands: split along X (respecting entrance gap via segments).
      if (aisleCount > 0 && aisleWidth > 0) {
        if (segment.height > segment.width) {
          // Vertical side band
          const minYSeg = segment.y
          const maxYSeg = segment.y + segment.height
          const gaps = []
          for (const center of sideAisleCenters) {
            if (center < minYSeg || center > maxYSeg) continue
            gaps.push({ min: center - aisleWidth / 2, max: center + aisleWidth / 2 })
          }

          let cursor = minYSeg
          for (const g of gaps) {
            const y0 = Math.max(cursor, minYSeg)
            const y1 = Math.min(g.min, maxYSeg)
            if (y1 - y0 > 0.02) {
              const x = segment.x * scale + this.renderContext.offsetX
              const y = y0 * scale + this.renderContext.offsetY
              const w = segment.width * scale
              const h = (y1 - y0) * scale
              this.ctx.fillRect(x, y, w, h)
              this.ctx.globalAlpha = 1
              this.ctx.strokeRect(x, y, w, h)
              this.ctx.globalAlpha = 0.55
            }
            cursor = Math.min(maxYSeg, g.max)
          }

          if (maxYSeg - cursor > 0.02) {
            const x = segment.x * scale + this.renderContext.offsetX
            const y = cursor * scale + this.renderContext.offsetY
            const w = segment.width * scale
            const h = (maxYSeg - cursor) * scale
            this.ctx.fillRect(x, y, w, h)
            this.ctx.globalAlpha = 1
            this.ctx.strokeRect(x, y, w, h)
            this.ctx.globalAlpha = 0.55
          }

          continue
        } else {
          // Horizontal bottom band
          const minXSeg = segment.x
          const maxXSeg = segment.x + segment.width
          const isLeftBottom = maxXSeg <= entranceStart + 1e-6
          const isRightBottom = minXSeg >= entranceEnd - 1e-6
          const gaps = []
          const centers = isLeftBottom
            ? bottomAisleCenters.left
            : isRightBottom
              ? bottomAisleCenters.right
              : []
          for (const center of centers) {
            if (center < minXSeg || center > maxXSeg) continue
            gaps.push({ min: center - aisleWidth / 2, max: center + aisleWidth / 2 })
          }

          let cursor = minXSeg
          for (const g of gaps) {
            const x0 = Math.max(cursor, minXSeg)
            const x1 = Math.min(g.min, maxXSeg)
            if (x1 - x0 > 0.02) {
              const x = x0 * scale + this.renderContext.offsetX
              const y = segment.y * scale + this.renderContext.offsetY
              const w = (x1 - x0) * scale
              const h = segment.height * scale
              this.ctx.fillRect(x, y, w, h)
              this.ctx.globalAlpha = 1
              this.ctx.strokeRect(x, y, w, h)
              this.ctx.globalAlpha = 0.55
            }
            cursor = Math.min(maxXSeg, g.max)
          }

          if (maxXSeg - cursor > 0.02) {
            const x = cursor * scale + this.renderContext.offsetX
            const y = segment.y * scale + this.renderContext.offsetY
            const w = (maxXSeg - cursor) * scale
            const h = segment.height * scale
            this.ctx.fillRect(x, y, w, h)
            this.ctx.globalAlpha = 1
            this.ctx.strokeRect(x, y, w, h)
            this.ctx.globalAlpha = 0.55
          }

          continue
        }
      }

      const x = segment.x * scale + this.renderContext.offsetX
      const y = segment.y * scale + this.renderContext.offsetY
      const width = segment.width * scale
      const height = segment.height * scale
      this.ctx.fillRect(x, y, width, height)
      this.ctx.globalAlpha = 1
      this.ctx.strokeRect(x, y, width, height)
      this.ctx.globalAlpha = 0.55
    }

    const ezs = this.layout.zones.filter(z => z.type === ZoneType.EMERGENCY)
    if (ezs.length > 0) {
      this.ctx.save()
      this.clipToGymFootprint()
      
      // Instead of destination-out (which creates transparency holes that look dark in exports),
      // we overpaint with the background color to create a clean gap.
      this.ctx.fillStyle = theme.background
      this.ctx.globalAlpha = 1

      // Carve a gap into the bleacher area so it behaves like an entrance gap (bleachers stop there).
      // Use full bleacher depth so the bleacher bands do not render across the emergency opening.
      const carveDepthPhysical = Math.max(0, bleacherDepth)

      for (const ez of ezs) {
        const ezMinX = ez.bounds.minX
        const ezMaxX = ez.bounds.maxX
        const ezMinY = ez.bounds.minY
        const ezMaxY = ez.bounds.maxY

        // Heuristics to decide which edge the emergency zone is aligned with.
        const isLeft = ezMaxX <= outerMinX + 0.01
        const isRight = ezMinX >= outerMaxX - 0.01
        const isBottom = ezMaxY >= outerMaxY - 0.01

        if (isLeft) {
          const x = ezMinX * scale + this.renderContext.offsetX
          const y = ezMinY * scale + this.renderContext.offsetY
          const w = carveDepthPhysical * scale
          const h = Math.max(0, (ezMaxY - ezMinY) * scale)
          this.ctx.fillRect(x, y, w, h)
        } else if (isRight) {
          const w = carveDepthPhysical * scale
          const x = ezMaxX * scale + this.renderContext.offsetX - w
          const y = ezMinY * scale + this.renderContext.offsetY
          const h = Math.max(0, (ezMaxY - ezMinY) * scale)
          this.ctx.fillRect(x, y, w, h)
        } else if (isBottom) {
          // For bottom-aligned emergency exits carve across the full bleacher depth, similar to entrance gaps
          const h = carveDepthPhysical * scale
          const x = ezMinX * scale + this.renderContext.offsetX
          const y = ezMaxY * scale + this.renderContext.offsetY - h
          const w = Math.max(0, (ezMaxX - ezMinX) * scale)
          this.ctx.fillRect(x, y, w, h)
        } else {
          // Fallback: if zone isn't near a gym edge, fall back to carving the zone footprint.
          const x = ezMinX * scale + this.renderContext.offsetX
          const y = ezMinY * scale + this.renderContext.offsetY
          const w = Math.max(0, (ezMaxX - ezMinX) * scale)
          const h = Math.max(0, (ezMaxY - ezMinY) * scale)
          this.ctx.fillRect(x, y, w, h)
        }
      }

      this.ctx.restore()
    }
    this.ctx.globalAlpha = 1
    this.ctx.restore()
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

    if (this.layout.stats.rowCount !== undefined && this.layout.stats.seatsPerRow !== undefined) {
      info.push(`Rows: ${this.layout.stats.rowCount}`)
      info.push(`Seats/Row: ${this.layout.stats.seatsPerRow}`)
    }

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
      lines.push(`• Seat: ${firstSeat.dimension.width.toFixed(2)}m x ${firstSeat.dimension.depth.toFixed(2)}m`)
    }
    if (this.layout.config?.aisles) {
      const aisles = this.layout.config.aisles
      lines.push(`• Side aisle: ${aisles.side.toFixed(2)}m`)
      lines.push(`• Front aisle: ${aisles.front.toFixed(2)}m`)
      lines.push(`• Back aisle: ${aisles.back.toFixed(2)}m`)
      lines.push(`• Red carpet: ${aisles.carpet.toFixed(2)}m`)
      lines.push(`• Horizontal aisle: ${(aisles.horizontal ?? 0).toFixed(2)}m`)
      if ((aisles.centerSide ?? 0) > 0) {
        lines.push(`• Center Side: ${aisles.centerSide!.toFixed(2)}m each`)
      }
    }

    for (const zone of this.layout.zones) {
      if (zone.type === ZoneType.AISLE) continue
      // Bleachers have their own renderer (bands + bleacher seats). Drawing them here too
      // causes duplicated "rear bleacher strips" visuals.
      if (zone.type === ZoneType.BLEACHER) continue
      if (zone.id.includes('reserved')) continue
      const width = zone.bounds.maxX - zone.bounds.minX
      const height = zone.bounds.maxY - zone.bounds.minY
      const zoneLabel = this.getZoneDisplayLabel(zone.id, zone.label || zone.type || 'Zone')
      if (!zoneLabel) continue
      lines.push(`• ${zoneLabel}: ${width.toFixed(1)}m x ${height.toFixed(1)}m`)
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
    if (!this.layout) return
    const theme = this.colors[this.renderOptions.theme || 'light']
    
    // Only include elements that are actually present in the layout
    const items: Array<{ color: string; label: string; isIcon?: boolean }> = []
    
    // 1. Graduates (Occupied seats)
    if (this.layout.seats.some(s => s.metadata.occupied)) {
      items.push({ color: '#10b981', label: 'Graduates' })
    }
    
    // 2. Faculty (VIP seats)
    if (this.layout.seats.some(s => s.metadata.vip)) {
      items.push({ color: theme.seatVip, label: 'PWD Seat' })
    }

    // 2.5 Bleacher Seat 1 & 2
    if (this.layout.seats.some(s => s.metadata.bleacherType === 1)) {
      items.push({ color: theme.seatBleacher1 || '#f97316', label: 'Parents Seat' })
    }
    if (this.layout.seats.some(s => s.metadata.bleacherType === 2)) {
      items.push({ color: theme.seatBleacher2 || '#8b5cf6', label: 'Faculty Seat' })
    }
    
    // 3. Stage
    if (this.layout.zones.some(z => z.type === ZoneType.STAGE)) {
      items.push({ color: theme.zone.stage, label: 'Stage' })
    }
    
    // 4. Medical Team (Table zones)
    if (this.layout.zones.some(z => z.id.includes('table'))) {
      items.push({ color: (theme.zone as any).medical, label: 'Medical Team' })
    }
    
    // 5. Photo Booth
    if (this.layout.zones.some(z => z.id === 'photobooth')) {
      items.push({ color: (theme.zone as any).photobooth, label: 'Photo Booth' })
    }
    
    // 6. Center Aisle (Carpet)
    if (this.layout.zones.some(z => z.id === 'aisle-carpet')) {
      items.push({ color: '#b91c1c', label: 'Center Aisle' })
    }
    
    // 7. Aisle (Other aisles)
    if (this.layout.zones.some(z => z.type === ZoneType.AISLE && z.id !== 'aisle-carpet')) {
      items.push({ color: '#ededed', label: 'Aisle' })
    }

    // 8. Emergency Exit
    if (this.layout.zones.some(z => z.type === ZoneType.EMERGENCY)) {
      items.push({ color: '#ef4444', label: 'Emergency Exit', isIcon: true })
    }

    if (items.length === 0) return

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

      if (item.isIcon) {
        // Draw the emergency icon centered in the swatch area
        this.drawEmergencyIcon(x + padding + swatchSize / 2, rowY + 2 + swatchSize / 2, swatchSize)
      } else {
        this.ctx.fillStyle = item.color
        this.ctx.fillRect(x + padding, rowY + 2, swatchSize, swatchSize)
        this.ctx.strokeStyle = 'rgba(0,0,0,0.15)'
        this.ctx.lineWidth = 1
        this.ctx.strokeRect(x + padding, rowY + 2, swatchSize, swatchSize)
      }

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

  private drawExitIcons(): void {
    if (!this.layout) return

    for (const zone of this.layout.zones) {
      if (zone.type === ZoneType.EMERGENCY || zone.id === 'entrance') {
        const centerX = (zone.bounds.minX + zone.bounds.maxX) / 2
        const centerY = (zone.bounds.minY + zone.bounds.maxY) / 2
        const screenX = centerX * this.renderContext.scale + this.renderContext.offsetX
        const screenY = centerY * this.renderContext.scale + this.renderContext.offsetY

        this.drawEmergencyIcon(screenX, screenY, 24)
      }
    }
  }

  private drawEmergencyIcon(x: number, y: number, size: number): void {
    this.ctx.save()
    this.ctx.translate(x, y)

    // Background red rounded rect
    const half = size / 2
    this.ctx.fillStyle = '#ef4444'
    this.ctx.beginPath()
    this.ctx.roundRect(-half, -half, size, size, 4)
    this.ctx.fill()

    // Simple white EXIT symbol
    this.ctx.strokeStyle = 'white'
    this.ctx.lineWidth = Math.max(1, size / 12)
    this.ctx.lineCap = 'round'
    this.ctx.lineJoin = 'round'

    // Door outline
    const doorPadding = size / 6
    this.ctx.strokeRect(-half + doorPadding, -half + doorPadding, size - doorPadding * 3, size - doorPadding * 2)

    // Running man / Arrow (simplified)
    this.ctx.beginPath()
    this.ctx.moveTo(0, 0)
    this.ctx.lineTo(half - doorPadding, 0)
    this.ctx.lineTo(half - doorPadding - 2, -2)
    this.ctx.moveTo(half - doorPadding, 0)
    this.ctx.lineTo(half - doorPadding - 2, 2)
    this.ctx.stroke()

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

  exportPNG(exportWidth = 3000, exportHeight = 2000): string {
    const previousOptions = { ...this.renderOptions }
    const previousContext = { ...this.renderContext }
    const previousCanvas = this.canvas
    const previousCtx = this.ctx

    // Create an offscreen canvas to avoid mutating the visible canvas state
    const offscreen = document.createElement('canvas')
    offscreen.width = exportWidth
    offscreen.height = exportHeight

    // Swap in offscreen canvas/context for rendering
    this.canvas = offscreen
    const offCtx = offscreen.getContext('2d')
    if (!offCtx) throw new Error('Could not get offscreen 2D context')
    this.ctx = offCtx
    
    // Set high quality smoothing
    this.ctx.imageSmoothingEnabled = true
    this.ctx.imageSmoothingQuality = 'high'

    // Maintain existing user render options (do not force labels if disabled in UI)
    this.renderOptions = {
      ...this.renderOptions
    }

    this.renderContext = { ...this.renderContext, width: exportWidth, height: exportHeight }

    // Mark exporting mode so we use the smallest font for labels/numbers
    this.isExporting = true

    if (this.layout) {
      this.fitLayoutInView(true)
    }

    // Ensure composite and alpha are reset for offscreen context
    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.globalAlpha = 1

    this.render()
    const dataUrl = offscreen.toDataURL('image/png')

    // Restore previous renderer state
    this.isExporting = false
    this.canvas = previousCanvas
    this.ctx = previousCtx
    this.renderContext = previousContext
    this.renderOptions = previousOptions

    if (this.layout) {
      this.render()
    }

    return dataUrl
  }
}

export function createRenderer(
  canvasElement: HTMLCanvasElement,
  options?: Partial<RenderOptions>
): Canvas2DRenderer {
  return new Canvas2DRenderer(canvasElement, options)
}
