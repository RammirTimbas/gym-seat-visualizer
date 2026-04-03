/**
 * Layout Generation Engine
 * Core algorithm for placing seats in a gym respecting all constraints
 */

import {
  GymConfig,
  LayoutOutput,
  Seat,
  SeatMetadata,
  GymnasiumShape,
  Zone,
  SeatType,
  ZoneType
} from './types'
import { pointInOval } from '../utils/geometry'

export class LayoutGenerator {
  private config: GymConfig
  private seats: Seat[] = []
  private usedArea: Set<string> = new Set()
  private tooDense: boolean = false

  constructor(config: GymConfig) {
    this.config = config
    this.validateConfig()
  }

  /**
   * Validate configuration for logical consistency
   */
  private validateConfig(): void {
    if (this.config.width <= 0 || this.config.length <= 0) {
      throw new Error('Gym dimensions must be positive')
    }

    if (this.config.minMargin < 0) {
      throw new Error('Minimum margin cannot be negative')
    }

    if (this.config.aisles.width < 0) {
      throw new Error('Aisle width cannot be negative')
    }

    // Validate bleachers if enabled
    if (this.config.bleachers?.enabled) {
      if (this.config.bleachers.numberOfSteps <= 0) {
        throw new Error('Number of bleacher steps must be positive')
      }
      if (this.config.bleachers.stepHeight <= 0) {
        throw new Error('Step height must be positive')
      }
      if (this.config.bleachers.width <= 0) {
        throw new Error('Bleacher depth must be positive')
      }
    }
  }

  /**
   * Generate complete layout
   */

  generate(): LayoutOutput {
    this.seats = []
    this.usedArea.clear()

    // Add aisle zones based on config
    this.addAisleZones()
    // Reserve zones
    this.reserveZones()
    // ... rest of generate logic ...
    // Place bleachers and seats (all available)
    let peopleRemaining = Number.POSITIVE_INFINITY
    if (this.config.bleachers?.enabled) {
      peopleRemaining -= this.placeBleachers(peopleRemaining)
    }
    switch (this.config.shape) {
      case GymnasiumShape.RECTANGLE:
      case GymnasiumShape.SQUARE:
        this.placeSeatsRectangularSmart(peopleRemaining)
        break
      case GymnasiumShape.OVAL:
        this.placeSeatsOvalSmart(peopleRemaining)
        break
      case GymnasiumShape.CIRCLE:
        this.placeSeatsCircularSmart(peopleRemaining)
        break
    }
    return this.buildOutput()
  }

  /**
   * Calculate optimal aisle positions using section-based optimization
   * Instead of equal spacing, sections are sized to maximize seating capacity
   * Places aisles sequentially: [Section] [Aisle] [Section] [Aisle] ... [Section]
   */
  private calculateOptimalAislePositions(
    startPosition: number,
    endPosition: number,
    aisleCount: number
  ): number[] {
    if (aisleCount <= 0) return []
    
    const { width: aisleWidth } = this.config.aisles
    const totalSpace = endPosition - startPosition
    const totalAisleSpace = aisleWidth * aisleCount
    if (totalSpace <= totalAisleSpace) return []
    const availableForSeats = totalSpace - totalAisleSpace
    
    // Each of (aisleCount + 1) sections gets equal width
    const sectionWidth = availableForSeats / (aisleCount + 1)
    
    // Calculate aisle centers by placing them sequentially
    // Aisle i is positioned at: start + (i sections of width) + (i-1 previous aisles) + (current aisle center)
    const positions: number[] = []
    let currentPosition = startPosition
    
    for (let i = 0; i < aisleCount; i++) {
      // Skip section i
      currentPosition += sectionWidth
      // Aisle center
      const aisleCenter = currentPosition + aisleWidth / 2
      positions.push(aisleCenter)
      // Move past this aisle
      currentPosition += aisleWidth
    }
    
    return positions
  }

  private getStageMaxY(): number {
    const stage = this.config.zones.find(z => z.type === ZoneType.STAGE)
    return stage ? stage.bounds.maxY : this.config.minMargin
  }

  private getBleacherDepth(): number {
    if (!this.config.bleachers?.enabled) return 0
    return Math.max(0, this.config.bleachers.width)
  }

  private getUsableFloorBounds() {
    const bleacherDepth = this.getBleacherDepth()
    const minX = this.config.minMargin + bleacherDepth
    const maxX = this.config.width - this.config.minMargin - bleacherDepth
    const minY = Math.max(this.config.minMargin, this.getStageMaxY())
    const maxY = this.config.length - this.config.minMargin - bleacherDepth

    return { minX, maxX, minY, maxY }
  }

  private isVerticalBleacherZone(zone: Zone): boolean {
    return zone.id === 'bleacher-left' || zone.id === 'bleacher-right'
  }

  /**
   * Add aisle zones to config.zones based on aisle controls
   */
  private addAisleZones(): void {
    // Remove any previous aisle zones
    this.config.zones = this.config.zones.filter(
      z => z.type !== ZoneType.AISLE && z.type !== ZoneType.BLEACHER
    )
    const { width, horizontal, vertical } = this.config.aisles
    const floorBounds = this.getUsableFloorBounds()
    
    // Horizontal aisles (run left-right, spaced along gym length)
    if (horizontal > 0 && width > 0) {
      const availableLength = floorBounds.maxY - floorBounds.minY
      if (availableLength > 0) {
        const positions = this.calculateOptimalAislePositions(
          floorBounds.minY,
          floorBounds.maxY,
          horizontal
        )
        
        for (let i = 0; i < positions.length; i++) {
          const centerY = positions[i]
          this.config.zones.push({
            id: `aisle-h-${i + 1}`,
            type: ZoneType.AISLE,
            bounds: {
              minX: floorBounds.minX,
              maxX: floorBounds.maxX,
              minY: centerY - width / 2,
              maxY: centerY + width / 2
            },
            label: 'Aisle'
          })
        }
      }
    }
    
    // Vertical aisles (run top-bottom, spaced along gym width)
    if (vertical > 0 && width > 0) {
      const positions = this.calculateOptimalAislePositions(
        floorBounds.minX,
        floorBounds.maxX,
        vertical
      )

      for (let i = 0; i < positions.length; i++) {
        const centerX = positions[i]
        this.config.zones.push({
          id: `aisle-v-${i + 1}`,
          type: ZoneType.AISLE,
          bounds: {
            minX: centerX - width / 2,
            maxX: centerX + width / 2,
            minY: floorBounds.minY,
            maxY: floorBounds.maxY
          },
          label: 'Aisle'
        })
      }
    }
  }

  private buildBleacherZones(): Zone[] {
    const config = this.config.bleachers
    if (!config?.enabled || config.width <= 0) return []

    const minX = this.config.minMargin
    const maxX = this.config.width - this.config.minMargin
    const minY = Math.max(this.config.minMargin, this.getStageMaxY())
    const maxY = this.config.length - this.config.minMargin
    const depth = Math.min(config.width, Math.max(0, (maxX - minX) / 2 - 0.1))
    const requestedEntranceWidth = Number.isFinite(config.entranceWidth) ? config.entranceWidth : 2.5
    const entranceWidth = Math.min(Math.max(requestedEntranceWidth, 0), Math.max(0, maxX - minX - 0.2))
    const entranceStart = (this.config.width - entranceWidth) / 2
    const entranceEnd = entranceStart + entranceWidth

    const zones: Zone[] = [
      {
        id: 'bleacher-left',
        type: ZoneType.BLEACHER,
        bounds: { minX, maxX: minX + depth, minY, maxY },
        label: 'Bleachers'
      },
      {
        id: 'bleacher-right',
        type: ZoneType.BLEACHER,
        bounds: { minX: maxX - depth, maxX, minY, maxY },
        label: 'Bleachers'
      },
      {
        id: 'bleacher-bottom-left',
        type: ZoneType.BLEACHER,
        bounds: { minX: minX + depth, maxX: entranceStart, minY: maxY - depth, maxY },
        label: 'Bleachers'
      },
      {
        id: 'bleacher-bottom-right',
        type: ZoneType.BLEACHER,
        bounds: { minX: entranceEnd, maxX: maxX - depth, minY: maxY - depth, maxY },
        label: 'Bleachers'
      }
    ]

    return zones.filter(
      zone =>
        zone.bounds.maxX - zone.bounds.minX > 0.1 &&
        zone.bounds.maxY - zone.bounds.minY > 0.1
    )
  }

  private distributeBleacherAisles(zones: Zone[]): number[][] {
    const totalAisles = Math.max(0, this.config.bleachers?.aisleCount || 0)
    const lengths = zones.map(zone =>
      this.isVerticalBleacherZone(zone)
        ? zone.bounds.maxY - zone.bounds.minY
        : zone.bounds.maxX - zone.bounds.minX
    )

    if (totalAisles === 0 || lengths.every(length => length <= 0)) {
      return zones.map(() => [])
    }

    const totalLength = lengths.reduce((sum, length) => sum + length, 0)
    const baseCounts = lengths.map(length => Math.floor((length / totalLength) * totalAisles))
    let assigned = baseCounts.reduce((sum, count) => sum + count, 0)

    const order = lengths
      .map((length, index) => ({
        index,
        remainder: (length / totalLength) * totalAisles - baseCounts[index]
      }))
      .sort((a, b) => b.remainder - a.remainder)

    for (let i = 0; assigned < totalAisles && i < order.length; i++, assigned++) {
      baseCounts[order[i].index]++
    }

    return zones.map((zone, index) => {
      const count = baseCounts[index]
      if (count <= 0) return []

      const start = this.isVerticalBleacherZone(zone) ? zone.bounds.minY : zone.bounds.minX
      const end = this.isVerticalBleacherZone(zone) ? zone.bounds.maxY : zone.bounds.maxX
      return this.calculateOptimalAislePositions(start, end, count)
    })
  }

  private getBleacherFixedCoordinate(zone: Zone, stepDepth: number, stepIndex: number): number {
    if (zone.id === 'bleacher-left') {
      return zone.bounds.minX + stepDepth * (stepIndex + 0.5)
    }
    if (zone.id === 'bleacher-right') {
      return zone.bounds.maxX - stepDepth * (stepIndex + 0.5)
    }

    return zone.bounds.maxY - stepDepth * (stepIndex + 0.5)
  }

  private overlapsBleacherAisle(
    axisCoord: number,
    aisleCenters: number[],
    aisleWidth: number,
    seatWidth: number
  ): boolean {
    return aisleCenters.some(center => Math.abs(axisCoord - center) < (aisleWidth + seatWidth) / 2)
  }

  // Place bleachers first if enabled, allocate as many people as possible there
  // (rest of generate method)
  // ...existing code...

  /**
   * Reserve blocked areas (stage, VIP, etc.)
   */
  private reserveZones(): void {
    this.reserveZoneList(this.config.zones)
  }

  private reserveZoneList(zones: Zone[]): void {
    for (const zone of zones) {
      // Mark zone area as occupied in the grid
      const startY = Math.floor(zone.bounds.minY * 100) // Convert to grid units (1cm)
      const startX = Math.floor(zone.bounds.minX * 100)
      const endY = Math.ceil(zone.bounds.maxY * 100)
      const endX = Math.ceil(zone.bounds.maxX * 100)

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          this.usedArea.add(`${x},${y}`)
        }
      }
    }
  }

  /**
   * Place seats in rectangular/square layout
   */

  /**
   * Place bleacher seats
   */
  // Place as many people as possible in bleachers, return number placed
  private placeBleachers(peopleToAllocate: number): number {
    if (
      this.config.shape === GymnasiumShape.RECTANGLE ||
      this.config.shape === GymnasiumShape.SQUARE
    ) {
      return this.placeBleachersRectangularContinuous(peopleToAllocate)
    }

    return this.placeBleachersSegmented(peopleToAllocate)
  }

  private placeBleachersRectangularContinuous(peopleToAllocate: number): number {
    const config = this.config.bleachers
    if (!config) return 0

    const seatType = this.config.seatTypes[0]
    if (!seatType) return 0

    const bleacherZones = this.buildBleacherZones()
    if (bleacherZones.length === 0) return 0

    const stepDepth = config.width / Math.max(config.numberOfSteps, 1)
    const bleacherSeatType = { ...seatType, type: SeatType.BLEACHER }
    const stageMaxY = this.getStageMaxY()
    const minX = this.config.minMargin
    const maxX = this.config.width - this.config.minMargin
    const maxY = this.config.length - this.config.minMargin
    const entranceStart = (this.config.width - config.entranceWidth) / 2
    const entranceEnd = entranceStart + config.entranceWidth
    const pitch = seatType.width + this.config.seatSpacing
    let placed = 0

    for (let step = 0; step < config.numberOfSteps; step++) {
      if (peopleToAllocate > 0 && placed >= peopleToAllocate) break

      const rowNumber = 1000 + step
      let positionInRow = 0
      let carry = seatType.width / 2
      const leftX = minX + stepDepth * (step + 0.5)
      const rightX = maxX - stepDepth * (step + 0.5)
      const rowY = maxY - stepDepth * (step + 0.5)

      const segments = [
        { kind: 'left' as const, start: stageMaxY + seatType.width / 2, end: rowY - seatType.width / 2, fixed: leftX, resetCarry: false },
        { kind: 'bottom' as const, start: leftX + seatType.width / 2, end: entranceStart - seatType.width / 2, fixed: rowY, resetCarry: false },
        { kind: 'bottom' as const, start: entranceEnd + seatType.width / 2, end: rightX - seatType.width / 2, fixed: rowY, resetCarry: true },
        { kind: 'right' as const, start: rowY - seatType.width / 2, end: stageMaxY + seatType.width / 2, fixed: rightX, resetCarry: false }
      ]

      for (const segment of segments) {
        if (peopleToAllocate > 0 && placed >= peopleToAllocate) break

        const forward = segment.end >= segment.start
        const length = Math.abs(segment.end - segment.start)
        if (length <= 0) {
          if (segment.resetCarry) carry = 0
          continue
        }

        let distance = carry
        while (distance <= length + 1e-6) {
          const coord = segment.start + (forward ? distance : -distance)
          const x = segment.kind === 'bottom' ? coord : segment.fixed
          const y = segment.kind === 'bottom' ? segment.fixed : coord

          if (!this.isPositionBlocked(x, y, bleacherSeatType) && this.pointInShape(x, y)) {
            const seat = this.createSeat(x, y, rowNumber, positionInRow, bleacherSeatType)
            seat.metadata.seatNumber = `${positionInRow + 1}`
            seat.metadata.bleacher = true
            this.seats.push(seat)
            this.markAreaAsUsed(x, y, bleacherSeatType.width, bleacherSeatType.depth)
            placed++
            positionInRow++
          }

          distance += pitch
        }

        carry = distance - length
        if (carry < seatType.width / 2) {
          carry += pitch
        }
        if (segment.resetCarry) {
          carry = seatType.width / 2
        }
      }
    }

    this.config.zones.push(...bleacherZones)
    this.reserveZoneList(bleacherZones)
    return placed
  }

  private placeBleachersSegmented(peopleToAllocate: number): number {
    const config = this.config.bleachers
    if (!config) return 0

    const seatType = this.config.seatTypes[0]
    if (!seatType) return 0

    const bleacherZones = this.buildBleacherZones()
    if (bleacherZones.length === 0) return 0

    let placed = 0
    const aisleAssignments = this.distributeBleacherAisles(bleacherZones)
    const stepDepth = config.width / Math.max(config.numberOfSteps, 1)
    const stepPositions = Array.from({ length: config.numberOfSteps }, () => 0)

    bleacherZones.forEach((zone, zoneIndex) => {
      const isVertical = this.isVerticalBleacherZone(zone)
      const aisleCenters = aisleAssignments[zoneIndex]
      const segmentStart = isVertical ? zone.bounds.minY : zone.bounds.minX
      const segmentEnd = isVertical ? zone.bounds.maxY : zone.bounds.maxX
      const bleacherSeatType = {
        ...seatType,
        type: SeatType.BLEACHER
      }
      const seatPitch = seatType.width + this.config.seatSpacing

      for (let step = 0; step < config.numberOfSteps; step++) {
        const rowNumber = 1000 + step
        const fixedCoord = this.getBleacherFixedCoordinate(zone, stepDepth, step)

        for (
          let axisCoord = segmentStart + seatType.width / 2;
          axisCoord + seatType.width / 2 <= segmentEnd;
          axisCoord += seatPitch
        ) {
          if (peopleToAllocate > 0 && placed >= peopleToAllocate) break
          if (this.overlapsBleacherAisle(axisCoord, aisleCenters, this.config.aisles.width, seatType.width)) continue

          const x = isVertical ? fixedCoord : axisCoord
          const y = isVertical ? axisCoord : fixedCoord

          if (!this.isPositionBlocked(x, y, bleacherSeatType) && this.pointInShape(x, y)) {
            const positionInRow = stepPositions[step]++
            const seat = this.createSeat(x, y, rowNumber, positionInRow, bleacherSeatType)
            seat.metadata.seatNumber = `${positionInRow + 1}`
            seat.metadata.bleacher = true
            this.seats.push(seat)
            this.markAreaAsUsed(x, y, bleacherSeatType.width, bleacherSeatType.depth)
            placed++
          }
        }
      }
    })

    this.config.zones.push(...bleacherZones)
    this.reserveZoneList(bleacherZones)
    return placed
  }

  // Place seats in rectangular/square layout, avoid area behind stage, maximize view
  private placeSeatsRectangularSmart(peopleToAllocate: number): void {
    const seatType = this.config.seatTypes[0]
    if (!seatType) return

    const floorBounds = this.getUsableFloorBounds()
    const startX = floorBounds.minX
    const usableWidth = floorBounds.maxX - floorBounds.minX
    const seatingStartY = floorBounds.minY
    const maxY = floorBounds.maxY
    let rowNumber = 0
    let placed = 0
    for (
      let currentY = seatingStartY + seatType.depth / 2;
      currentY + seatType.depth / 2 < maxY;
      currentY += seatType.depth + this.config.rowSpacing
    ) {
      if (typeof this.config.maxRows === 'number' && this.config.maxRows >= 0 && rowNumber >= this.config.maxRows) break
      // Orient row to face stage (all rows parallel to stage front)
      placed += this.placeRowRectangularSmart(rowNumber, currentY, startX, usableWidth, seatType, peopleToAllocate - placed)
      rowNumber++
      if (peopleToAllocate > 0 && placed >= peopleToAllocate) break
    }
  }

  // Place a smart row, stop if peopleToAllocate reached
  private placeRowRectangularSmart(
    rowNumber: number,
    baseY: number,
    startX: number,
    usableWidth: number,
    seatType: typeof this.config.seatTypes[0],
    peopleToAllocate: number
  ): number {
    let positionInRow = 0
    const seatsPerRow = Math.floor(
      (usableWidth - this.config.aisles.width) / (seatType.width + this.config.seatSpacing)
    )
    const totalRowWidth =
      seatsPerRow * seatType.width + (seatsPerRow - 1) * this.config.seatSpacing
    const rowCenterX = startX + (usableWidth - totalRowWidth) / 2
    let placed = 0
    for (let i = 0; i < seatsPerRow; i++) {
      if (peopleToAllocate > 0 && placed >= peopleToAllocate) break
      const seatX =
        rowCenterX + i * (seatType.width + this.config.seatSpacing) + seatType.width / 2
      const seatY = baseY
      if (!this.isPositionBlocked(seatX, seatY, seatType)) {
        const seat = this.createSeat(seatX, seatY, rowNumber, positionInRow, seatType)
        this.seats.push(seat)
        positionInRow++
        this.markAreaAsUsed(seatX, seatY, seatType.width, seatType.depth)
        placed++
      }
    }
    return placed
  }

  // Place seats in oval layout, avoid area behind stage, maximize view
  private placeSeatsOvalSmart(peopleToAllocate: number): void {
    // For brevity, use same as placeSeatsOval but skip seats behind stage if present
    // (A real implementation would do more advanced sightline analysis)
    const seatType = this.config.seatTypes[0]
    if (!seatType) return
    const centerX = this.config.width / 2
    const centerY = this.config.length / 2
    const radiusX = (this.config.width - 2 * this.config.minMargin) / 2
    const radiusY = (this.config.length - 2 * this.config.minMargin) / 2
    let rowNumber = 0
    let placed = 0
    const stage = this.config.zones?.find(z => z.type === 'stage')
    const stageEndY = stage ? stage.bounds.maxY : 0
    for (let r = 0.3; r <= 1.0; r += (seatType.depth + this.config.rowSpacing) / Math.max(radiusY, 1)) {
      if (typeof this.config.maxRows === 'number' && this.config.maxRows >= 0 && rowNumber >= this.config.maxRows) break
      const currentRadiusX = radiusX * r
      const currentRadiusY = radiusY * r
      const ovalCircumference = 2 * Math.PI * Math.sqrt((currentRadiusX ** 2 + currentRadiusY ** 2) / 2)
      const seatsPerOval = Math.max(4, Math.floor(ovalCircumference / (seatType.width + this.config.seatSpacing)))
      for (let i = 0; i < seatsPerOval; i++) {
        if (peopleToAllocate > 0 && placed >= peopleToAllocate) break
        const angle = (i / seatsPerOval) * Math.PI * 2
        const x = centerX + currentRadiusX * Math.cos(angle)
        const y = centerY + currentRadiusY * Math.sin(angle)
        // Only place seats below the stage (y > stageEndY)
        if (y > stageEndY && !this.isPositionBlocked(x, y, seatType) && this.pointInShape(x, y)) {
          const seat = this.createSeat(x, y, rowNumber, i, seatType)
          this.seats.push(seat)
          this.markAreaAsUsed(x, y, seatType.width, seatType.depth)
          placed++
        }
      }
      rowNumber++
      if (peopleToAllocate > 0 && placed >= peopleToAllocate) break
    }
  }

  // Place seats in circular layout, avoid area behind stage, maximize view
  private placeSeatsCircularSmart(peopleToAllocate: number): void {
    // For brevity, use same as placeSeatsCircular but skip seats behind stage if present
    const seatType = this.config.seatTypes[0]
    if (!seatType) return
    const centerX = this.config.width / 2
    const centerY = this.config.length / 2
    const radius = Math.min(this.config.width, this.config.length) / 2 - this.config.minMargin
    let rowNumber = 0
    let placed = 0
    const stage = this.config.zones?.find(z => z.type === 'stage')
    const stageEndY = stage ? stage.bounds.maxY : 0
    for (let r = 0.3; r <= 1.0; r += (seatType.depth + this.config.rowSpacing) / radius) {
      if (typeof this.config.maxRows === 'number' && this.config.maxRows >= 0 && rowNumber >= this.config.maxRows) break
      const currentRadius = radius * r
      const circumference = 2 * Math.PI * currentRadius
      const seatsPerRing = Math.max(4, Math.floor(circumference / (seatType.width + this.config.seatSpacing)))
      for (let i = 0; i < seatsPerRing; i++) {
        if (peopleToAllocate > 0 && placed >= peopleToAllocate) break
        const angle = (i / seatsPerRing) * Math.PI * 2
        const x = centerX + currentRadius * Math.cos(angle)
        const y = centerY + currentRadius * Math.sin(angle)
        if (y > stageEndY && !this.isPositionBlocked(x, y, seatType) && this.pointInShape(x, y)) {
          const seat = this.createSeat(x, y, rowNumber, i, seatType)
          this.seats.push(seat)
          this.markAreaAsUsed(x, y, seatType.width, seatType.depth)
          placed++
        }
      }
      rowNumber++
      if (peopleToAllocate > 0 && placed >= peopleToAllocate) break
    }
  }


  /**
   * Check if a position is blocked by a zone or another seat
   */
  private isPositionBlocked(
    x: number,
    y: number,
    seatType: typeof this.config.seatTypes[0]
  ): boolean {
    // Check against zones
    for (const zone of this.config.zones) {
      if (
        x - seatType.width / 2 < zone.bounds.maxX &&
        x + seatType.width / 2 > zone.bounds.minX &&
        y - seatType.depth / 2 < zone.bounds.maxY &&
        y + seatType.depth / 2 > zone.bounds.minY
      ) {
        return true
      }
    }

    // Check against used area grid
    const gridX = Math.floor(x * 100)
    const gridY = Math.floor(y * 100)
    return this.usedArea.has(`${gridX},${gridY}`)
  }

  /**
   * Check if point is within gymnasium shape
   */
  private pointInShape(x: number, y: number): boolean {
    const centerX = this.config.width / 2
    const centerY = this.config.length / 2

    switch (this.config.shape) {
      case GymnasiumShape.CIRCLE: {
        const radius = Math.min(this.config.width, this.config.length) / 2
        const dx = x - centerX
        const dy = y - centerY
        return dx * dx + dy * dy <= radius * radius
      }

      case GymnasiumShape.OVAL: {
        const radiusX = this.config.width / 2
        const radiusY = this.config.length / 2
        return pointInOval(x, y, centerX, centerY, radiusX, radiusY)
      }

      case GymnasiumShape.RECTANGLE:
      case GymnasiumShape.SQUARE:
      default:
        return (
          x >= this.config.minMargin &&
          x <= this.config.width - this.config.minMargin &&
          y >= this.config.minMargin &&
          y <= this.config.length - this.config.minMargin
        )
    }
  }

  /**
   * Mark area as used
   */
  private markAreaAsUsed(
    x: number,
    y: number,
    width: number,
    depth: number
  ): void {
    const startX = Math.floor((x - width / 2) * 100)
    const startY = Math.floor((y - depth / 2) * 100)
    const endX = Math.ceil((x + width / 2) * 100)
    const endY = Math.ceil((y + depth / 2) * 100)

    const nominalTotalCells = Math.ceil(this.config.width * 100) * Math.ceil(this.config.length * 100)
    const MAX_SET_SIZE = Math.max(1000000, Math.min(20000000, nominalTotalCells * 2))

    for (let gridY = startY; gridY < endY; gridY++) {
      for (let gridX = startX; gridX < endX; gridX++) {
        if (this.usedArea.size >= MAX_SET_SIZE) {
          this.tooDense = true
          return
        }
        this.usedArea.add(`${gridX},${gridY}`)
      }
    }
  }

  /**
   * Create a seat object
   */
  private createSeat(
    x: number,
    y: number,
    row: number,
    position: number,
    seatType: typeof this.config.seatTypes[0]
  ): Seat {
    const seatId = `${row}-${position}`
    const seatNumber = `${position + 1}`

    const metadata: SeatMetadata = {
      id: seatId,
      row,
      position,
      type: seatType.type,
      accessible: position % 4 === 0,
      blocked: false,
      vip: false,
      occupied: false,
      seatNumber
    }

    return {
      id: seatId,
      position: { x, y },
      dimension: seatType,
      metadata
    }
  }

  /**
   * Build output with statistics
   */
  private buildOutput(): LayoutOutput {
    const seatsByType = this.countSeatsByType()
    const occupiedSeats = this.seats.filter(s => s.metadata.occupied).length

    return {
      configId: this.config.id,
      timestamp: Date.now(),
      totalSeats: this.seats.length,
      occupiedSeats,
      occupiedAreas: occupiedSeats * (this.config.seatTypes[0]?.width || 0.5) * (this.config.seatTypes[0]?.depth || 0.5),
      utilizationRatio: occupiedSeats / Math.max(this.seats.length, 1),
      warning: this.tooDense ? 'Layout became dense before hitting every target seat; showing max feasible seats.' : undefined,
      seats: this.seats,
      zones: this.config.zones,
      config: this.config,
      stats: {
        seatsByType,
        seatsByAccessibility: {
          accessible: this.seats.filter(s => s.metadata.accessible).length,
          standard: this.seats.filter(s => !s.metadata.accessible).length
        },
        seatsByCategory: {
          vip: this.seats.filter(s => s.metadata.vip).length,
          regular: this.seats.filter(s => !s.metadata.vip).length
        },
        seatsByOccupancy: {
          occupied: occupiedSeats,
          empty: this.seats.length - occupiedSeats
        }
      }
    }
  }

  /**
   * Count seats by type
   */
  private countSeatsByType(): Record<string, number> {
    const counts: Record<string, number> = {}

    for (const seat of this.seats) {
      const type = seat.metadata.type
      counts[type] = (counts[type] || 0) + 1
    }

    return counts
  }
}

export function generateLayout(config: GymConfig): LayoutOutput {
  const generator = new LayoutGenerator(config)
  return generator.generate()
}
