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
  private leftCounter: number = 0
  private rightCounter: number = 0

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
      this.config.aisles.carpet < 0 ||
      (this.config.aisles.horizontal ?? 0) < 0
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

  private shiftBottomZones(): void {
    const bleacherDepth = this.getBleacherDepth()
    if (bleacherDepth <= 0) return

    const margin = this.config.minMargin
    const gymLength = this.config.length
    
    // The "base" for bottom elements should be the top edge of the bleacher footprint
    const bleacherTopY = gymLength - margin - bleacherDepth

    this.config.zones = this.config.zones.map(zone => {
      const id = zone.id.toLowerCase()
      if (id === 'photobooth' || id.startsWith('table')) {
        const height = zone.bounds.maxY - zone.bounds.minY
        // Move zone so its maxY is at the bleacher's top edge
        return {
          ...zone,
          bounds: {
            ...zone.bounds,
            minY: bleacherTopY - height,
            maxY: bleacherTopY
          }
        }
      }
      return zone
    })
  }

  generate(): LayoutOutput {
    this.seats = []
    this.usedArea.clear()
    this.leftCounter = 0
    this.rightCounter = 0

    // Adjust bottom zones to sit on top of bleachers
    this.shiftBottomZones()

    // Add aisle zones based on config
    this.addAisleZones()
    
    // Reserve STAGE first (bleachers must respect the stage)
    this.reserveZoneList(this.config.zones.filter(z => z.type === ZoneType.STAGE))

    // Place bleachers and seats (fill all available space)
    let peopleRemaining = Number.POSITIVE_INFINITY

    if (this.config.bleachers?.enabled) {
      this.placeBleachers(peopleRemaining)
    }

    // After bleachers are placed, reserve OTHER non-aisle zones (photobooth, medical, etc.)
    // and then aisles so floor seats respect them.
    this.reserveZoneList(this.config.zones.filter(z => 
      z.type !== ZoneType.AISLE && 
      z.type !== ZoneType.BLEACHER && 
      z.type !== ZoneType.STAGE
    ))
    
    this.reserveZoneList(this.config.zones.filter(z => z.type === ZoneType.AISLE))

    // Place faculty seats
    this.placeFacultySeats()

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

    // Safety pass: ensure floor seats never end up inside bleacher footprint.
    // This can happen near chamfered corners if zone math/drift changes; bleachers should be exclusive.
    this.removeNonBleacherSeatsInsideBleachers()
    return this.buildOutput()
  }

  private removeNonBleacherSeatsInsideBleachers(): void {
    const bleacherZones = this.config.zones.filter(z => z.type === ZoneType.BLEACHER)
    if (bleacherZones.length === 0) return

    this.seats = this.seats.filter(seat => {
      if (seat.metadata.bleacher) return true

      const halfW = seat.dimension.width / 2
      const halfD = seat.dimension.depth / 2
      const minX = seat.position.x - halfW
      const maxX = seat.position.x + halfW
      const minY = seat.position.y - halfD
      const maxY = seat.position.y + halfD

      for (const z of bleacherZones) {
        if (maxX > z.bounds.minX && minX < z.bounds.maxX && maxY > z.bounds.minY && minY < z.bounds.maxY) {
          return false
        }
      }
      return true
    })
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
      { x: 0, y: chamferStartY },
      { x: 0, y: 0 }
    ]
  }

  private getFootprintXSpanAtY(y: number): { minX: number; maxX: number } {
    const width = this.config.width
    const length = this.config.length
    const inset = this.getBottomInset()
    const chamferStartY = this.getChamferStartY()

    if (y <= chamferStartY) return { minX: 0, maxX: width }
    if (y >= length) return { minX: inset, maxX: width - inset }

    const t = (y - chamferStartY) / Math.max(length - chamferStartY, 1e-6)
    const dx = inset * t
    return { minX: dx, maxX: width - dx }
  }

  private getFootprintMaxYAtX(x: number): number {
    const width = this.config.width
    const length = this.config.length
    const inset = this.getBottomInset()
    const chamferStartY = this.getChamferStartY()

    if (inset <= 1e-6) return length

    if (x <= inset) {
      const t = Math.max(0, Math.min(1, x / inset))
      return chamferStartY + t * (length - chamferStartY)
    }

    if (x >= width - inset) {
      const t = Math.max(0, Math.min(1, (width - x) / inset))
      return chamferStartY + t * (length - chamferStartY)
    }

    return length
  }

  private clampBoundsToFootprint(bounds: Zone['bounds']): Zone['bounds'][] {
    // For rectangle/square, the "gym floor" is a chamfered polygon (see getFloorPolygon).
    // Zones are axis-aligned rectangles, so we approximate intersection by splitting at the
    // chamfer start and clamping the lower part's X span to the polygon at that Y.
    //
    // To better match the diagonal chamfer edge (visually and for collision), we slice the
    // lower part into a few horizontal bands and clamp each band independently.
    if (
      this.config.shape !== GymnasiumShape.RECTANGLE &&
      this.config.shape !== GymnasiumShape.SQUARE
    ) {
      return [bounds]
    }

    const chamferStartY = this.getChamferStartY()

    if (bounds.maxY <= chamferStartY) return [bounds]

    const results: Zone['bounds'][] = []

    // Top part (no chamfer)
    if (bounds.minY < chamferStartY) {
      results.push({ ...bounds, maxY: chamferStartY })
    }

    const startY = Math.max(bounds.minY, chamferStartY)
    const endY = bounds.maxY
    const totalH = Math.max(0, endY - startY)

    // 3-6 slices depending on height; keeps zone counts sane.
    const slices = Math.max(3, Math.min(6, Math.ceil(totalH / 0.6)))
    const sliceH = totalH / Math.max(1, slices)

    for (let i = 0; i < slices; i++) {
      const y0 = startY + i * sliceH
      const y1 = i === slices - 1 ? endY : startY + (i + 1) * sliceH
      if (y1 - y0 <= 1e-6) continue

      const span = this.getFootprintXSpanAtY(y1)
      results.push({
        minX: Math.max(bounds.minX, span.minX),
        maxX: Math.min(bounds.maxX, span.maxX),
        minY: y0,
        maxY: y1
      })
    }

    return results
  }

  private getBleacherDepth(): number {
    if (!this.config.bleachers?.enabled) return 0
    
    const config = this.config.bleachers
    const seatType = this.config.seatTypes[0]
    const minStepDepth = seatType ? seatType.depth + 0.1 : 0.6 // Minimum depth to fit a seat comfortably
    const totalSteps = config.numberOfSteps + 1 // Including the aisle step
    const minRequiredWidth = totalSteps * minStepDepth
    
    return Math.max(config.width, minRequiredWidth)
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

  private getFacultyWidth(): number {
    const facultyCount = this.config.facultyCount || 0
    if (facultyCount <= 0) return 0

    const layout = this.getFacultyLayout()
    if (!layout) return 0

    const seatType = this.config.seatTypes[0]
    return layout.columnsPerSide * (seatType.width + this.config.horizontalSpacing)
  }

  private getFacultyLayout() {
    const facultyCount = this.config.facultyCount || 0
    if (facultyCount <= 0) return null

    const seatType = this.config.seatTypes[0]
    
    // Usable length for faculty rows (same as floor seats)
    const minY = Math.max(this.config.minMargin, this.getStageMaxY()) + this.config.aisles.front
    const maxY = this.getBackAisleMinY()
    const usableLength = maxY - minY

    if (usableLength <= 0) return null

    const rowSpacing = seatType.depth + this.config.verticalSpacing
    const maxRows = Math.floor((usableLength + this.config.verticalSpacing) / rowSpacing)
    
    if (maxRows <= 0) return null

    const facultyPerSide = Math.ceil(facultyCount / 2)
    
    // Explicitly set 25 rows and 3 columns if faculty count is 150
    if (facultyCount === 150) {
      return {
        maxRows: 25,
        columnsPerSide: 3,
        facultyPerSide: 75,
        minY,
        usableLength
      }
    }
    
    // Calculate columns needed by filling them fully (no tapering)
    const columnsPerSide = Math.ceil(facultyPerSide / maxRows)

    return {
      maxRows,
      columnsPerSide,
      facultyPerSide,
      minY,
      usableLength
    }
  }

  private getBackAisleMinY(): number {
    const { back } = this.config.aisles
    const stageMaxY = this.getStageMaxY()
    const bleacherDepth = this.getBleacherDepth()
    const bottomBlocked = this.getBottomBlockedDepth()
    const rearLimitY = this.config.length - this.config.minMargin - bleacherDepth
    
    // The back aisle ends where the shifted bottom obstacles (photobooth/tables) begin.
    const backAisleMaxY = Math.max(stageMaxY, rearLimitY - bottomBlocked)
    return Math.max(stageMaxY, backAisleMaxY - back)
  }

  private getUsableFloorBounds() {
    const bleacherDepth = this.getBleacherDepth()
    // Floor seats only need to respect the side bleachers and side aisles.
    // Faculty seats are row-dependent and handled by the usedArea collision grid.
    const minX = this.config.minMargin + bleacherDepth + this.config.aisles.side
    const maxX = this.config.width - this.config.minMargin - bleacherDepth - this.config.aisles.side
    const minY = Math.max(this.config.minMargin, this.getStageMaxY()) + this.config.aisles.front
    const maxY = this.getBackAisleMinY()

    return { minX, maxX, minY, maxY }
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
    const horizontal = this.config.aisles.horizontal ?? 0
    const stageMaxY = Math.max(0, this.getStageMaxY())
    const bleacherDepth = this.getBleacherDepth()
    const facultyWidth = this.getFacultyWidth()
    const rearLimitY = this.config.length - this.config.minMargin - bleacherDepth

    // Check for Tables at the bottom to avoid overlap
    const bottomBlocked = this.getBottomBlockedDepth();

    if (side > 0) {
      this.config.zones.push(
        {
          id: 'aisle-side-left',
          type: ZoneType.AISLE,
          bounds: {
            minX: this.config.minMargin + bleacherDepth + facultyWidth,
            maxX: this.config.minMargin + bleacherDepth + facultyWidth + side,
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
            minX: this.config.width - this.config.minMargin - bleacherDepth - facultyWidth - side,
            maxX: this.config.width - this.config.minMargin - bleacherDepth - facultyWidth,
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
      const backAisleMinY = this.getBackAisleMinY()
      const backAisleMaxY = Math.max(stageMaxY, rearLimitY - bottomBlocked)
      this.config.zones.push({
        id: 'aisle-back',
        type: ZoneType.AISLE,
        bounds: {
          minX: this.config.minMargin + bleacherDepth + facultyWidth + side,
          maxX: this.config.width - this.config.minMargin - bleacherDepth - facultyWidth - side,
          minY: backAisleMinY,
          maxY: backAisleMaxY
        },
        label: 'Back Aisle'
      })
    }

    if (carpet > 0) {
      const minY = stageMaxY + front
      const maxY = this.getBackAisleMinY()
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

    // Horizontal (cross) aisle centered in usable floor height
    if (horizontal > 0) {
      const usableMinY = stageMaxY + front
      const usableMaxY = this.getBackAisleMinY()
      if (usableMaxY > usableMinY + 0.05) {
        const centerY = (usableMinY + usableMaxY) / 2
        const aisleMinY = Math.max(usableMinY, centerY - horizontal / 2)
        const aisleMaxY = Math.min(usableMaxY, centerY + horizontal / 2)

        // Only add if it has visible height inside the usable region
        if (aisleMaxY - aisleMinY > 0.05) {
          this.config.zones.push({
            id: 'aisle-horizontal',
            type: ZoneType.AISLE,
            bounds: {
              minX: this.config.minMargin + bleacherDepth + facultyWidth + side,
              maxX:
                this.config.width - this.config.minMargin - bleacherDepth - facultyWidth - side,
              minY: aisleMinY,
              maxY: aisleMaxY
            },
            label: 'Horizontal Aisle'
          })
        }
      }
    }
  }

  private buildBleacherZones(): Zone[] {
    const config = this.config.bleachers
    const bleacherDepth = this.getBleacherDepth()
    if (!config?.enabled || bleacherDepth <= 0) return []

    const minX = this.config.minMargin
    const maxX = this.config.width - this.config.minMargin
    const minY = Math.max(this.config.minMargin, this.getStageMaxY())
    // Bleachers own the bottom strip; bottom elements (photobooth/medical) are moved upward when bleachers are enabled.
    const maxY = this.config.length - this.config.minMargin
    const depth = Math.min(bleacherDepth, Math.max(0, (maxX - minX) / 2 - 0.1))
    const requestedEntranceWidth = Number.isFinite(config.entranceWidth) ? config.entranceWidth : 2.5
    const entranceWidth = Math.min(Math.max(requestedEntranceWidth, 0), Math.max(0, maxX - minX - 0.2))
    const entranceStart = (this.config.width - entranceWidth) / 2
    const entranceEnd = entranceStart + entranceWidth

    const rawZones: Zone[] = [
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
      // Bottom bleachers: place them above bottomBlocked area, and carve out any explicit bottom blocked rectangles.
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

    const zones: Zone[] = []
    for (const zone of rawZones) {
      let clampedBoundsList = this.clampBoundsToFootprint(zone.bounds)

      // Subtract explicit bottom blocked rectangles from bottom bleacher bands so they don't overlap tables/photobooth.
      if (zone.id.startsWith('bleacher-bottom')) {
        const blockers = this.config.zones.filter(z =>
          z.id === 'table-left' || z.id === 'table-right' || z.id === 'photobooth'
        )

        if (blockers.length > 0) {
          const next: Zone['bounds'][] = []
          for (const b of clampedBoundsList) {
            // For each blocker, split b into up to 2 rectangles in X if overlap.
            let currentParts: Zone['bounds'][] = [b]
            for (const blk of blockers) {
              const updated: Zone['bounds'][] = []
              for (const part of currentParts) {
                const overlaps =
                  part.minX < blk.bounds.maxX &&
                  part.maxX > blk.bounds.minX &&
                  part.minY < blk.bounds.maxY &&
                  part.maxY > blk.bounds.minY

                if (!overlaps) {
                  updated.push(part)
                  continue
                }

                // If blocker intersects, keep left remainder and right remainder (same Y span).
                const left: Zone['bounds'] = {
                  minX: part.minX,
                  maxX: Math.min(part.maxX, blk.bounds.minX),
                  minY: part.minY,
                  maxY: part.maxY
                }
                const right: Zone['bounds'] = {
                  minX: Math.max(part.minX, blk.bounds.maxX),
                  maxX: part.maxX,
                  minY: part.minY,
                  maxY: part.maxY
                }

                if (left.maxX - left.minX > 0.05) updated.push(left)
                if (right.maxX - right.minX > 0.05) updated.push(right)
              }
              currentParts = updated
              if (currentParts.length === 0) break
            }
            next.push(...currentParts)
          }
          clampedBoundsList = next
        }
      }

      for (let i = 0; i < clampedBoundsList.length; i++) {
        const b = clampedBoundsList[i]
        zones.push({
          ...zone,
          // Keep ids stable but unique if split
          id: clampedBoundsList.length > 1 ? `${zone.id}__${i}` : zone.id,
          bounds: b
        })
      }
    }

    return zones.filter(z => z.bounds.maxX - z.bounds.minX > 0.1 && z.bounds.maxY - z.bounds.minY > 0.1)
  }

  /**
   * Reserve blocked areas (stage, VIP, etc.)
   */
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

    const bleacherDepth = this.getBleacherDepth()
    // Add an extra step that will serve as a central aisle (empty of seats)
    const totalPhysicalSteps = config.numberOfSteps + 1
    const stepDepth = bleacherDepth / Math.max(totalPhysicalSteps, 1)
    const aisleStepIndex = Math.floor(totalPhysicalSteps / 2)

    const bleacherSeatType = { ...seatType, type: SeatType.BLEACHER }
    const stageMaxY = this.getStageMaxY()
    const minX = this.config.minMargin
    const maxX = this.config.width - this.config.minMargin
    // Bleachers are allowed to occupy the bottom strip; bottom elements are moved upward when bleachers are enabled.
    const maxY = this.config.length - this.config.minMargin
    const requestedEntranceWidth = Number.isFinite(config.entranceWidth) ? config.entranceWidth : 2.5
    const entranceWidth = Math.min(Math.max(requestedEntranceWidth, 0), Math.max(0, maxX - minX - 0.2))
    const entranceStart = (this.config.width - entranceWidth) / 2
    const entranceEnd = entranceStart + entranceWidth
    const pitch = seatType.width + this.config.horizontalSpacing
    const aisleCount = Math.max(0, Math.floor(config.aisleCount || 0))
    const requestedAisleWidth = Number.isFinite(config.aisleWidth as number) ? (config.aisleWidth as number) : 0
    const defaultAisleWidth = seatType.width + this.config.horizontalSpacing
    const bleacherAisleWidth = Math.max(0, requestedAisleWidth || defaultAisleWidth)
    let placed = 0
    const sideAisleCenters = (() => {
      if (aisleCount <= 0) return [] as number[]
      const spanMinY = stageMaxY + seatType.width / 2
      const spanMaxY = maxY - seatType.width / 2
      const usable = Math.max(0, spanMaxY - spanMinY)
      if (usable <= 0.2) return [] as number[]
      return Array.from({ length: aisleCount }, (_, i) => spanMinY + (usable * (i + 1)) / (aisleCount + 1))
    })()
    const bottomAisleCenters = (() => {
      const result = { left: [] as number[], right: [] as number[] }
      if (aisleCount <= 0) return result

      const leftCount = Math.ceil(aisleCount / 2)
      const rightCount = Math.floor(aisleCount / 2)

      const leftMinX = minX + seatType.width / 2
      const leftMaxX = entranceStart - seatType.width / 2
      const leftUsable = Math.max(0, leftMaxX - leftMinX)
      if (leftCount > 0 && leftUsable > 0.2) {
        result.left = Array.from(
          { length: leftCount },
          (_, i) => leftMinX + (leftUsable * (i + 1)) / (leftCount + 1)
        )
      }

      const rightMinX = entranceEnd + seatType.width / 2
      const rightMaxX = maxX - seatType.width / 2
      const rightUsable = Math.max(0, rightMaxX - rightMinX)
      if (rightCount > 0 && rightUsable > 0.2) {
        result.right = Array.from(
          { length: rightCount },
          (_, i) => rightMinX + (rightUsable * (i + 1)) / (rightCount + 1)
        )
      }

      return result
    })()
    const globalSideCoords = getEvenlySpacedCoords(
      stageMaxY + seatType.width / 2,
      maxY - seatType.width / 2,
      pitch
    )
    const globalBottomLeftCoords = getEvenlySpacedCoords(
      minX + seatType.width / 2,
      entranceStart - seatType.width / 2,
      pitch
    )
    const globalBottomRightCoords = getEvenlySpacedCoords(
      entranceEnd + seatType.width / 2,
      maxX - seatType.width / 2,
      pitch
    )

    // Add bleacher zones before placing bleacher seats so we can test membership, but don't reserve them
    // in usedArea until after bleacher seats are placed (otherwise we'd block our own placement).
    this.config.zones.push(...bleacherZones)

    // Create a single emergency exit zone for the left and right bleacher groups (visual overlay, reserved area)
    try {
      const emergencyHeight = this.config.emergencyExitHeight ?? 1.0
      const forwardExtension = Math.min(1.0, emergencyHeight * 0.4)

      const leftBleachers = bleacherZones.filter(z => z.id.startsWith('bleacher-left'))
      const rightBleachers = bleacherZones.filter(z => z.id.startsWith('bleacher-right'))

      const makeCombinedBounds = (zones: Zone[]): Zone['bounds'] | null => {
        if (!zones || zones.length === 0) return null
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        for (const z of zones) {
          const b = z.bounds
          minX = Math.min(minX, b.minX)
          maxX = Math.max(maxX, b.maxX)
          minY = Math.min(minY, b.minY)
          maxY = Math.max(maxY, b.maxY)
        }
        if (minX === Infinity) return null
        return { minX, maxX, minY, maxY }
      }

      const leftBounds = makeCombinedBounds(leftBleachers)
      const rightBounds = makeCombinedBounds(rightBleachers)

      const emergencyZones: Zone[] = []

      const buildEmergencyFor = (sideBounds: Zone['bounds'] | null, sideId: string) => {
        if (!sideBounds) return
        const minX = Math.max(0, sideBounds.minX - 0.05)
        const maxX = Math.min(this.config.width, sideBounds.maxX + 0.05)
        // Center emergency zone on the bleacher band's vertical midpoint
        const centerY = (sideBounds.minY + sideBounds.maxY) / 2
        let minY = centerY - emergencyHeight / 2
        let maxY = centerY + emergencyHeight / 2
        // Extend slightly forward (toward the floor interior = smaller Y direction)
        minY = Math.max(0, minY - forwardExtension)
        // Clamp to gym bounds
        maxY = Math.min(this.config.length, maxY)

        if (maxX - minX > 0.05 && maxY - minY > 0.05) {
          emergencyZones.push({
            id: sideId,
            type: ZoneType.EMERGENCY,
            label: 'Emergency Exit',
            bounds: { minX, maxX, minY, maxY }
          })
        }
      }

      buildEmergencyFor(leftBounds, 'emergency-left')
      buildEmergencyFor(rightBounds, 'emergency-right')

      if (emergencyZones.length > 0) this.config.zones.push(...emergencyZones)
    } catch (err) {
      // Non-fatal; emergency zones are optional
    }

    const canPlacePair = (placedSoFar: number): boolean => {
      if (peopleToAllocate <= 0) return true
      return placedSoFar + 2 <= peopleToAllocate
    }

    function getEvenlySpacedCoords(start: number, end: number, spacing: number): number[] {
      const forward = end >= start
      const length = Math.abs(end - start)
      if (length <= 1e-6 || spacing <= 1e-6) return []

      // Center seat centers within the segment so both ends get equal leftover margin.
      const count = Math.floor(length / spacing) + 1
      if (count <= 0) return []
      const usedLength = (count - 1) * spacing
      const margin = (length - usedLength) / 2

      return Array.from({ length: count }, (_, i) => {
        const distance = margin + i * spacing
        return start + (forward ? distance : -distance)
      })
    }

    

    for (let step = 0; step < totalPhysicalSteps; step++) {
      if (peopleToAllocate > 0 && placed >= peopleToAllocate) break
      
      // Skip seat placement for the aisle step
      if (step === aisleStepIndex) continue

      const rowNumber = 1000 + step
      let positionInRow = 0
      const leftX = minX + stepDepth * (step + 0.5)
      const rightX = maxX - stepDepth * (step + 0.5)
      const rowY = maxY - stepDepth * (step + 0.5)
      const halfSeatW = seatType.width / 2
      const halfSeatD = seatType.depth / 2
      const spanAtRow = this.getFootprintXSpanAtY(rowY)
      const leftVerticalEnd = Math.min(rowY - halfSeatW, this.getFootprintMaxYAtX(leftX) - halfSeatD)
      const rightVerticalStart = Math.min(
        rowY - halfSeatW,
        this.getFootprintMaxYAtX(rightX) - halfSeatD
      )
      const bottomStartX = Math.max(leftX + halfSeatW, spanAtRow.minX + halfSeatW)
      const bottomEndX = Math.min(rightX - halfSeatW, spanAtRow.maxX - halfSeatW)

      const segments = [
        {
          kind: 'left' as const,
          start: stageMaxY + seatType.width / 2,
          end: leftVerticalEnd,
          fixed: leftX
        },
        {
          kind: 'bottom' as const,
          start: bottomStartX,
          end: Math.min(entranceStart - seatType.width / 2, bottomEndX),
          fixed: rowY
        },
        {
          kind: 'bottom' as const,
          start: Math.max(entranceEnd + seatType.width / 2, bottomStartX),
          end: bottomEndX,
          fixed: rowY
        },
        {
          kind: 'right' as const,
          start: rightVerticalStart,
          end: stageMaxY + seatType.width / 2,
          fixed: rightX
        }
      ]

      type CandidateSeat = { x: number; y: number }
      const candidatesBySegment = new Map<string, CandidateSeat[]>()

      const pushCandidate = (segmentKey: string, x: number, y: number) => {
        const list = candidatesBySegment.get(segmentKey) || []
        list.push({ x, y })
        candidatesBySegment.set(segmentKey, list)
      }

      for (const segment of segments) {
        const segmentKey =
          segment.kind === 'left'
            ? 'left'
            : segment.kind === 'right'
              ? 'right'
              : segment.end <= entranceStart - seatType.width / 2 + 1e-6
                ? 'bottom-left'
                : 'bottom-right'

        const segmentMin = Math.min(segment.start, segment.end)
        const segmentMax = Math.max(segment.start, segment.end)
        const coords =
          segmentKey === 'left' || segmentKey === 'right'
            ? globalSideCoords.filter(c => c >= segmentMin - 1e-6 && c <= segmentMax + 1e-6)
            : segmentKey === 'bottom-left'
              ? globalBottomLeftCoords.filter(c => c >= segmentMin - 1e-6 && c <= segmentMax + 1e-6)
              : globalBottomRightCoords.filter(c => c >= segmentMin - 1e-6 && c <= segmentMax + 1e-6)

        for (const coord of coords) {
          const x = segment.kind === 'bottom' ? coord : segment.fixed
          const y = segment.kind === 'bottom' ? segment.fixed : coord

          const inBleacherAisle = (() => {
            if (aisleCount <= 0) return false

            if (segment.kind === 'left' || segment.kind === 'right') {
              return sideAisleCenters.some(center => Math.abs(y - center) <= bleacherAisleWidth / 2)
            }

            const isLeftBottom = segmentKey === 'bottom-left'
            const segmentMinX = Math.min(segment.start, segment.end)
            const segmentMaxX = Math.max(segment.start, segment.end)
            const centers = isLeftBottom ? bottomAisleCenters.left : bottomAisleCenters.right
            return centers.some(center => {
              if (center < segmentMinX || center > segmentMaxX) return false
              return Math.abs(x - center) <= bleacherAisleWidth / 2
            })
          })()

          

          const bandLeftMinX = minX + stepDepth * step
          const bandLeftMaxX = minX + stepDepth * (step + 1)
          const bandRightMinX = maxX - stepDepth * (step + 1)
          const bandRightMaxX = maxX - stepDepth * step
          const bandBottomMinY = maxY - stepDepth * (step + 1)
          const bandBottomMaxY = maxY - stepDepth * step

          // Lenient checks: allow seats to fit even if stepDepth is slightly smaller than seat depth/width.
          // We center the seat on the physical step but check if its center is within the step bounds (with tolerance).
          const epsilon = 0.05 // 5cm tolerance
          const inLeftBand =
            x >= bandLeftMinX - epsilon &&
            x <= bandLeftMaxX + epsilon &&
            y >= stageMaxY - epsilon &&
            y <= maxY + epsilon

          const inRightBand =
            x >= bandRightMinX - epsilon &&
            x <= bandRightMaxX + epsilon &&
            y >= stageMaxY - epsilon &&
            y <= maxY + epsilon

          const inBottomBand =
            y >= bandBottomMinY - epsilon &&
            y <= bandBottomMaxY + epsilon &&
            x >= minX - epsilon &&
            x <= maxX + epsilon &&
            (x <= entranceStart + epsilon || x >= entranceEnd - epsilon)

          const inBleacherZone = inLeftBand || inRightBand || inBottomBand

          if (
            !inBleacherAisle &&
            inBleacherZone &&
            !this.isPositionBlocked(x, y, bleacherSeatType) &&
            this.pointInShape(x, y)
          ) {
            pushCandidate(segmentKey, x, y)
          }
        }
      }

      const placePairedSeats = (a: CandidateSeat[], b: CandidateSeat[]) => {
        const pairCount = Math.min(a.length, b.length)
        for (let i = 0; i < pairCount; i++) {
          if (!canPlacePair(placed)) return
          const pair = [a[i], b[i]]
          for (const item of pair) {
            const seat = this.createSeat(item.x, item.y, rowNumber, positionInRow, bleacherSeatType)
            seat.metadata.seatNumber = `B${step + 1}-${positionInRow + 1}`
            seat.metadata.bleacher = true
            this.seats.push(seat)
            this.markAreaAsUsed(item.x, item.y, bleacherSeatType.width, bleacherSeatType.depth)
            placed++
            positionInRow++
          }
        }
      }

      placePairedSeats(candidatesBySegment.get('left') || [], candidatesBySegment.get('right') || [])
      placePairedSeats(
        candidatesBySegment.get('bottom-left') || [],
        candidatesBySegment.get('bottom-right') || []
      )
    }

    // After placing bleacher seats, reserve the bleacher footprint so floor seats don't overlap it.
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

    // Optional horizontal (cross) aisle: skip placing rows through this Y band.
    const horizontalAisle = this.config.aisles.horizontal ?? 0
    let horizontalAisleMinY = Number.POSITIVE_INFINITY
    let horizontalAisleMaxY = Number.NEGATIVE_INFINITY
    if (horizontalAisle > 0 && maxY > seatingStartY + 0.05) {
      const centerY = (seatingStartY + maxY) / 2
      horizontalAisleMinY = Math.max(seatingStartY, centerY - horizontalAisle / 2)
      horizontalAisleMaxY = Math.min(maxY, centerY + horizontalAisle / 2)
      if (horizontalAisleMaxY - horizontalAisleMinY <= 0.05) {
        horizontalAisleMinY = Number.POSITIVE_INFINITY
        horizontalAisleMaxY = Number.NEGATIVE_INFINITY
      }
    }

    // If fixedRows is set, we might need to adjust vertical spacing to fit them
    // or just stop when we hit the limit.
    const maxRows = this.config.fixedRows ?? this.config.maxRows ?? Number.POSITIVE_INFINITY

    const pitch = seatType.depth + this.config.verticalSpacing
    let currentY = seatingStartY + seatType.depth / 2

    while (currentY + seatType.depth / 2 < maxY) {
      if (rowNumber >= maxRows) break

      const rowMinY = currentY - seatType.depth / 2
      const rowMaxY = currentY + seatType.depth / 2
      const intersectsHorizontalAisle =
        rowMaxY > horizontalAisleMinY && rowMinY < horizontalAisleMaxY

      if (intersectsHorizontalAisle) {
        // Jump to the first row center that sits fully below the aisle band.
        currentY = horizontalAisleMaxY + seatType.depth / 2
        continue
      }

      // Orient row to face stage (all rows parallel to stage front)
      placed += this.placeRowRectangularSmart(rowNumber, currentY, startX, usableWidth, seatType, peopleToAllocate - placed)
      rowNumber++
      if (peopleToAllocate > 0 && placed >= peopleToAllocate) break

      currentY += pitch
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
    // Use fixedSeatsPerRow if provided, otherwise calculate max possible
    const seatsPerRow = this.config.fixedSeatsPerRow ?? Math.floor(
      (usableWidth + this.config.horizontalSpacing) / (seatType.width + this.config.horizontalSpacing)
    )

    const totalRowWidth =
      seatsPerRow * seatType.width + (seatsPerRow - 1) * this.config.horizontalSpacing

    // Center the row exactly based on gym width to ensure symmetry
    const rowStartX = centerX - totalRowWidth / 2

    let placedInRow = 0
    for (let i = 0; i < seatsPerRow; i++) {
      if (peopleToAllocate > 0 && placedInRow >= peopleToAllocate) break

      const seatX = rowStartX + i * (seatType.width + this.config.horizontalSpacing) + seatType.width / 2
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

    const epsilon = 0.001 // 1mm buffer to handle precision issues
    // Check against zones
    for (const zone of this.config.zones) {
      // Bleacher seats are allowed to exist inside bleacher zones (that's the whole point).
      // For all other seat types, bleacher zones remain blocking.
      if (seatType.type === SeatType.BLEACHER && zone.type === ZoneType.BLEACHER) {
        continue
      }
      // Bleacher seats should ignore emergency zones (overlay below bleachers)
      if (seatType.type === SeatType.BLEACHER && zone.type === ZoneType.EMERGENCY) {
        continue
      }
      // Bleacher seating should not be constrained by floor aisles; aisles apply to floor seating area.
      if (seatType.type === SeatType.BLEACHER && zone.type === ZoneType.AISLE) {
        continue
      }
      if (
        x - seatType.width / 2 < zone.bounds.maxX - epsilon &&
        x + seatType.width / 2 > zone.bounds.minX + epsilon &&
        y - seatType.depth / 2 < zone.bounds.maxY - epsilon &&
        y + seatType.depth / 2 > zone.bounds.minY + epsilon
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
    seatType: typeof this.config.seatTypes[0],
    isVip: boolean = false
  ): Seat {
    const seatId = `${row}-${position}`
    const centerX = this.config.width / 2
    let seatNumber = `${position + 1}`

    // Ordinary seats get continuous numbering, separate for left/right
    if (!isVip && seatType.type !== SeatType.BLEACHER) {
      if (x < centerX) {
        this.leftCounter++
        seatNumber = `${this.leftCounter}`
      } else {
        this.rightCounter++
        seatNumber = `${this.rightCounter}`
      }
    }

    const metadata: SeatMetadata = {
      id: seatId,
      row,
      position,
      type: seatType.type,
      accessible: position % 4 === 0,
      blocked: false,
      vip: isVip,
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

  private placeFacultySeats(): void {
    const layout = this.getFacultyLayout()
    if (!layout || !this.config.facultyCount) return

    const seatType = this.config.seatTypes[0]
    const bleacherDepth = this.getBleacherDepth()
    const horizontalPitch = seatType.width + this.config.horizontalSpacing
    const verticalPitch = seatType.depth + this.config.verticalSpacing
    
    const facultyCount = this.config.facultyCount
    const leftToPlace = Math.floor(facultyCount / 2)
    const rightToPlace = facultyCount - leftToPlace

    let totalPlaced = 0

    // Left Faculty
    let leftRemaining = leftToPlace
    for (let col = 0; col < layout.columnsPerSide && leftRemaining > 0; col++) {
      const x = this.config.minMargin + bleacherDepth + col * horizontalPitch + seatType.width / 2
      const seatsInThisCol = Math.min(leftRemaining, layout.maxRows)
      
      const colHeight = seatsInThisCol * seatType.depth + (seatsInThisCol - 1) * this.config.verticalSpacing
      const colMinY = layout.minY + (layout.usableLength - colHeight) / 2

      for (let row = 0; row < seatsInThisCol; row++) {
        const y = colMinY + row * verticalPitch + seatType.depth / 2
        if (this.pointInShape(x, y)) {
          totalPlaced++
          const seat = this.createSeat(x, y, 5000 + row, col, seatType, true)
          seat.metadata.seatNumber = `F-${totalPlaced}`
          this.seats.push(seat)
          this.markAreaAsUsed(x, y, seatType.width, seatType.depth)
        }
      }
      leftRemaining -= seatsInThisCol
    }

    // Right Faculty
    let rightRemaining = rightToPlace
    for (let col = 0; col < layout.columnsPerSide && rightRemaining > 0; col++) {
      const x = this.config.width - this.config.minMargin - bleacherDepth - col * horizontalPitch - seatType.width / 2
      const seatsInThisCol = Math.min(rightRemaining, layout.maxRows)
      
      const colHeight = seatsInThisCol * seatType.depth + (seatsInThisCol - 1) * this.config.verticalSpacing
      const colMinY = layout.minY + (layout.usableLength - colHeight) / 2

      for (let row = 0; row < seatsInThisCol; row++) {
        const y = colMinY + row * verticalPitch + seatType.depth / 2
        if (this.pointInShape(x, y)) {
          totalPlaced++
          const seat = this.createSeat(x, y, 6000 + row, col, seatType, true)
          seat.metadata.seatNumber = `F-${totalPlaced}`
          this.seats.push(seat)
          this.markAreaAsUsed(x, y, seatType.width, seatType.depth)
        }
      }
      rightRemaining -= seatsInThisCol
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
