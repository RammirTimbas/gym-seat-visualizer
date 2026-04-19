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
import { pointInOval, pointInPolygon } from '../utils/geometry'

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

    if (
      this.config.aisles.side < 0 ||
      this.config.aisles.front < 0 ||
      this.config.aisles.back < 0 ||
      this.config.aisles.carpet < 0
    ) {
      throw new Error('Aisle widths cannot be negative')
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
    // Place bleachers and seats (fill all available space)
    let peopleRemaining = Number.POSITIVE_INFINITY

    if (this.config.bleachers?.enabled) {
      this.placeBleachers(peopleRemaining)
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

  private getStageMaxY(): number {
    const stage = this.config.zones.find(z => z.type === ZoneType.STAGE)
    return stage ? stage.bounds.maxY : this.config.minMargin
  }

  private getBottomInset(): number {
    return Math.min(this.config.width * 0.14, 4)
  }

  private getChamferStartY(): number {
    return Math.max(
      this.config.length - Math.min(this.config.length * 0.12, 3),
      this.config.length * 0.82
    )
  }

  private getFloorPolygon() {
    const width = this.config.width
    const length = this.config.length
    const inset = this.getBottomInset()
    const chamferStartY = this.getChamferStartY()

    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: chamferStartY },
      { x: width - inset, y: length },
      { x: inset, y: length },
      { x: 0, y: chamferStartY }
    ]
  }

  private calculateDistributedCenters(
    startPosition: number,
    endPosition: number,
    laneWidth: number,
    laneCount: number
  ): number[] {
    if (laneCount <= 0 || laneWidth <= 0) return []

    const totalSpace = endPosition - startPosition
    const totalLaneSpace = laneWidth * laneCount
    if (totalSpace <= totalLaneSpace) return []

    const sectionWidth = (totalSpace - totalLaneSpace) / (laneCount + 1)
    const positions: number[] = []
    let currentPosition = startPosition

    for (let i = 0; i < laneCount; i++) {
      currentPosition += sectionWidth
      positions.push(currentPosition + laneWidth / 2)
      currentPosition += laneWidth
    }

    return positions
  }

  private getBleacherDepth(): number {
    if (!this.config.bleachers?.enabled) return 0
    return Math.max(0, this.config.bleachers.width)
  }

  private getBottomBlockedDepth(): number {
    const blockedAtBottom = this.config.zones.filter(z =>
      z.id === 'table-left' || z.id === 'table-right' || z.id === 'photobooth'
    );
    if (blockedAtBottom.length > 0) {
      return Math.max(...blockedAtBottom.map(z => z.bounds.maxY - z.bounds.minY));
    }
    return 0;
  }

  private getUsableFloorBounds() {
    const bleacherDepth = this.getBleacherDepth()
    const bottomBlocked = this.getBottomBlockedDepth()
    const minX = this.config.minMargin + bleacherDepth + this.config.aisles.side
    const maxX = this.config.width - this.config.minMargin - bleacherDepth - this.config.aisles.side
    const minY = Math.max(this.config.minMargin, this.getStageMaxY()) + this.config.aisles.front
    const maxY = this.config.length - this.config.minMargin - bleacherDepth - this.config.aisles.back - bottomBlocked

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
    const { side, front, back, carpet } = this.config.aisles
    const stageMaxY = Math.max(0, this.getStageMaxY())

    // Check for Tables at the bottom to avoid overlap
    const bottomBlocked = this.getBottomBlockedDepth();

    if (side > 0) {
      this.config.zones.push(
        {
          id: 'aisle-side-left',
          type: ZoneType.AISLE,
          bounds: {
            minX: this.config.minMargin,
            maxX: this.config.minMargin + side,
            // Side aisles now span the full height of the gym floor
            minY: 0,
            maxY: this.config.length
          },
          label: 'Side Aisle'
        },
        {
          id: 'aisle-side-right',
          type: ZoneType.AISLE,
          bounds: {
            minX: this.config.width - this.config.minMargin - side,
            maxX: this.config.width - this.config.minMargin,
            // Side aisles now span the full height of the gym floor
            minY: 0,
            maxY: this.config.length
          },
          label: 'Side Aisle'
        }
      )
    }

    if (front > 0) {
      this.config.zones.push({
        id: 'aisle-front',
        type: ZoneType.AISLE,
        bounds: {
          minX: this.config.minMargin,
          maxX: this.config.width - this.config.minMargin,
          minY: stageMaxY,
          maxY: stageMaxY + front
        },
        label: 'Front Aisle'
      })
    }

    if (back > 0) {
      this.config.zones.push({
        id: 'aisle-back',
        type: ZoneType.AISLE,
        bounds: {
          minX: this.getBottomInset(),
          maxX: this.config.width - this.getBottomInset(),
          minY: this.config.length - bottomBlocked - back,
          maxY: this.config.length - bottomBlocked
        },
        label: 'Back Aisle'
      })
    }

    if (carpet > 0) {
      const minY = stageMaxY + front
      const maxY = this.config.length - back - bottomBlocked
      if (maxY > minY) {
        this.config.zones.push({
          id: 'aisle-carpet',
          type: ZoneType.AISLE,
          bounds: {
            minX: this.config.width / 2 - carpet / 2,
            maxX: this.config.width / 2 + carpet / 2,
            minY,
            maxY
          },
          label: 'Red Carpet'
        })
      }
    }
  }

  private buildBleacherZones(): Zone[] {
    const config = this.config.bleachers
    if (!config?.enabled || config.width <= 0) return []

    const bottomBlocked = this.getBottomBlockedDepth();
    const minX = this.config.minMargin
    const maxX = this.config.width - this.config.minMargin
    const minY = Math.max(this.config.minMargin, this.getStageMaxY())
    const maxY = this.config.length - this.config.minMargin - bottomBlocked
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
      return this.calculateDistributedCenters(start, end, this.getPrimaryAisleWidth(), count)
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
    return 0
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
    const bottomBlocked = this.getBottomBlockedDepth()
    const maxY = this.config.length - this.config.minMargin - bottomBlocked
    const entranceStart = (this.config.width - config.entranceWidth) / 2
    const entranceEnd = entranceStart + config.entranceWidth
    const pitch = seatType.width + this.config.horizontalSpacing
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

    // If fixedRows is set, we might need to adjust vertical spacing to fit them
    // or just stop when we hit the limit.
    const maxRows = this.config.fixedRows ?? this.config.maxRows ?? Number.POSITIVE_INFINITY

    for (
      let currentY = seatingStartY + seatType.depth / 2;
      currentY + seatType.depth / 2 < maxY;
      currentY += seatType.depth + this.config.verticalSpacing
    ) {
      if (rowNumber >= maxRows) break

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
    const carpetWidth = this.config.aisles.carpet
    const centerX = this.config.width / 2

    // If we have a center carpet, we split the row into two sections
    if (carpetWidth > 0) {
      const leftSectionEndX = centerX - carpetWidth / 2
      const rightSectionStartX = centerX + carpetWidth / 2
      
      const leftWidth = leftSectionEndX - startX
      const rightWidth = (startX + usableWidth) - rightSectionStartX
      
      const seatsPerSectionLeft = Math.floor(
        (leftWidth + this.config.horizontalSpacing) / (seatType.width + this.config.horizontalSpacing)
      )
      const seatsPerSectionRight = Math.floor(
        (rightWidth + this.config.horizontalSpacing) / (seatType.width + this.config.horizontalSpacing)
      )
      
      // For even distribution, we take the minimum of both sides
      const seatsPerSection = Math.min(seatsPerSectionLeft, seatsPerSectionRight)
      
      const sectionRowWidth = seatsPerSection * seatType.width + (seatsPerSection - 1) * this.config.horizontalSpacing
      
      let placedInRow = 0
      let positionInRow = 0

      // Place Left Section
      const leftRowStartX = leftSectionEndX - sectionRowWidth
      for (let i = 0; i < seatsPerSection; i++) {
        if (peopleToAllocate > 0 && placedInRow >= peopleToAllocate) break
        const seatX = leftRowStartX + i * (seatType.width + this.config.horizontalSpacing) + seatType.width / 2
        if (!this.isPositionBlocked(seatX, baseY, seatType)) {
          const seat = this.createSeat(seatX, baseY, rowNumber, positionInRow, seatType)
          this.seats.push(seat)
          this.markAreaAsUsed(seatX, baseY, seatType.width, seatType.depth)
          placedInRow++
          positionInRow++
        }
      }

      // Place Right Section
      const rightRowStartX = rightSectionStartX
      for (let i = 0; i < seatsPerSection; i++) {
        if (peopleToAllocate > 0 && placedInRow >= peopleToAllocate) break
        const seatX = rightRowStartX + i * (seatType.width + this.config.horizontalSpacing) + seatType.width / 2
        if (!this.isPositionBlocked(seatX, baseY, seatType)) {
          const seat = this.createSeat(seatX, baseY, rowNumber, positionInRow, seatType)
          this.seats.push(seat)
          this.markAreaAsUsed(seatX, baseY, seatType.width, seatType.depth)
          placedInRow++
          positionInRow++
        }
      }
      
      return placedInRow
    }

    let positionInRow = 0
    // ... rest of the original logic for no carpet ...
    // Use fixedSeatsPerRow if provided, otherwise calculate max possible
    const seatsPerRow = this.config.fixedSeatsPerRow ?? Math.floor(
      (usableWidth + this.config.horizontalSpacing) / (seatType.width + this.config.horizontalSpacing)
    )

    const totalRowWidth =
      seatsPerRow * seatType.width + (seatsPerRow - 1) * this.config.horizontalSpacing

    // Center the row if usableWidth > totalRowWidth
    const rowCenterX = startX + Math.max(0, (usableWidth - totalRowWidth) / 2)

    let placedInRow = 0
    for (let i = 0; i < seatsPerRow; i++) {
      if (peopleToAllocate > 0 && placedInRow >= peopleToAllocate) break

      const seatX =
        rowCenterX + i * (seatType.width + this.config.horizontalSpacing) + seatType.width / 2
      const seatY = baseY

      if (!this.isPositionBlocked(seatX, seatY, seatType)) {
        const seat = this.createSeat(seatX, seatY, rowNumber, positionInRow, seatType)
        this.seats.push(seat)
        positionInRow++
        this.markAreaAsUsed(seatX, seatY, seatType.width, seatType.depth)
        placedInRow++
      }
    }
    return placedInRow
  }

  // Place seats in oval layout, avoid area behind stage, maximize view
  private placeSeatsOvalSmart(peopleToAllocate: number): void {
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
    for (let r = 0.3; r <= 1.0; r += (seatType.depth + this.config.verticalSpacing) / Math.max(radiusY, 1)) {
      if (typeof this.config.maxRows === 'number' && this.config.maxRows >= 0 && rowNumber >= this.config.maxRows) break
      const currentRadiusX = radiusX * r
      const currentRadiusY = radiusY * r
      const ovalCircumference = 2 * Math.PI * Math.sqrt((currentRadiusX ** 2 + currentRadiusY ** 2) / 2)
      const seatsPerOval = Math.max(4, Math.floor((ovalCircumference + this.config.horizontalSpacing) / (seatType.width + this.config.horizontalSpacing)))
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
    const seatType = this.config.seatTypes[0]
    if (!seatType) return
    const centerX = this.config.width / 2
    const centerY = this.config.length / 2
    const radius = Math.min(this.config.width, this.config.length) / 2 - this.config.minMargin
    let rowNumber = 0
    let placed = 0
    const stage = this.config.zones?.find(z => z.type === 'stage')
    const stageEndY = stage ? stage.bounds.maxY : 0
    for (let r = 0.3; r <= 1.0; r += (seatType.depth + this.config.verticalSpacing) / radius) {
      if (typeof this.config.maxRows === 'number' && this.config.maxRows >= 0 && rowNumber >= this.config.maxRows) break
      const currentRadius = radius * r
      const circumference = 2 * Math.PI * currentRadius
      const seatsPerRing = Math.max(4, Math.floor((circumference + this.config.horizontalSpacing) / (seatType.width + this.config.horizontalSpacing)))
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
    if (!this.isSeatWithinShape(x, y, seatType)) {
      return true
    }

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

  private isSeatWithinShape(
    x: number,
    y: number,
    seatType: typeof this.config.seatTypes[0]
  ): boolean {
    const halfW = seatType.width / 2
    const halfD = seatType.depth / 2
    const corners = [
      { x: x - halfW, y: y - halfD },
      { x: x + halfW, y: y - halfD },
      { x: x + halfW, y: y + halfD },
      { x: x - halfW, y: y + halfD }
    ]

    return corners.every(corner => this.pointInShape(corner.x, corner.y))
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
        return pointInPolygon({ x, y }, this.getFloorPolygon())
    }
  }

  private getPrimaryAisleWidth(): number {
    return Math.max(
      this.config.aisles.side,
      this.config.aisles.front,
      this.config.aisles.back,
      this.config.aisles.carpet
    )
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

    // Calculate grid dimensions
    const floorSeats = this.seats.filter(s => !s.metadata.bleacher)
    const rows = new Set(floorSeats.map(s => s.metadata.row))
    const rowCount = rows.size

    let maxSeatsInRow = 0
    if (rowCount > 0) {
        const seatsPerRowMap = new Map<number, number>()
        floorSeats.forEach(s => {
            const count = seatsPerRowMap.get(s.metadata.row) || 0
            seatsPerRowMap.set(s.metadata.row, count + 1)
        })
        maxSeatsInRow = Math.max(...Array.from(seatsPerRowMap.values()))
    }

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
        },
        rowCount,
        seatsPerRow: maxSeatsInRow
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
