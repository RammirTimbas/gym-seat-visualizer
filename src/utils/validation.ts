/**
 * Validation Utilities
 * Helper functions for validating configurations and layouts
 */

import { GymConfig, LayoutOutput, Seat } from '../core/types'
import { boundsArea, distance2D } from './geometry'

// ============================================================================
// Configuration Validation
// ============================================================================

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate a gym configuration
 */
export function validateConfig(config: GymConfig): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Basic dimensions
  if (config.width <= 0) {
    errors.push('Gym width must be positive')
  }
  if (config.length <= 0) {
    errors.push('Gym length must be positive')
  }
  if (config.height && config.height <= 0) {
    warnings.push('Height is not specified (needed for 3D rendering)')
  }

  // Margins and aisles
  if (config.minMargin < 0) {
    errors.push('Minimum margin cannot be negative')
  }
  if (
    config.aisles.side < 0 ||
    config.aisles.front < 0 ||
    config.aisles.back < 0 ||
    config.aisles.carpet < 0
  ) {
    errors.push('Aisle widths cannot be negative')
  }

  // Spacing
  if (config.horizontalSpacing < 0) {
    errors.push('Horizontal spacing cannot be negative')
  }
  if (config.verticalSpacing < 0) {
    errors.push('Vertical spacing cannot be negative')
  }

  // Seat types
  if (config.seatTypes.length === 0) {
    errors.push('At least one seat type must be defined')
  }

  for (let i = 0; i < config.seatTypes.length; i++) {
    const seatType = config.seatTypes[i]
    if (seatType.width <= 0) {
      errors.push(`Seat type ${i}: width must be positive`)
    }
    if (seatType.depth <= 0) {
      errors.push(`Seat type ${i}: depth must be positive`)
    }
    if (seatType.height && seatType.height <= 0) {
      warnings.push(`Seat type ${i}: height not specified`)
    }
  }

  // Zones
  for (const zone of config.zones) {
    const area = boundsArea(zone.bounds)
    if (area <= 0) {
      errors.push(`Zone ${zone.id}: has invalid bounds`)
    }

    // Check for overlap with usable area (reserved for validation logic)
    if (
      zone.bounds.minX < config.minMargin ||
      zone.bounds.maxX > config.width - config.minMargin ||
      zone.bounds.minY < config.minMargin ||
      zone.bounds.maxY > config.length - config.minMargin
    ) {
      warnings.push(`Zone ${zone.id}: extends beyond gym margins`)
    }
  }

  // Check if gym is too cramped
  const usableArea =
    (config.width - 2 * config.minMargin) * (config.length - 2 * config.minMargin)
  const seatArea = config.seatTypes[0].width * config.seatTypes[0].depth
  const estimatedSeats = (usableArea / (seatArea + config.horizontalSpacing + config.verticalSpacing)) | 0

  if (estimatedSeats < 10) {
    warnings.push(`Estimated seating capacity is very low (~${estimatedSeats} seats)`)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// ============================================================================
// Layout Validation
// ============================================================================

/**
 * Validate a generated layout
 */
export function validateLayout(
  layout: LayoutOutput,
  config: GymConfig
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check total seats
  if (layout.totalSeats === 0) {
    warnings.push('Layout contains no seats')
  }

  // Check seat positioning
  let outOfBounds = 0
  let seatOverlaps = 0

  for (const seat of layout.seats) {
    const halfW = seat.dimension.width / 2
    const halfD = seat.dimension.depth / 2

    // Check bounds
    if (
      seat.position.x - halfW < 0 ||
      seat.position.x + halfW > config.width ||
      seat.position.y - halfD < 0 ||
      seat.position.y + halfD > config.length
    ) {
      outOfBounds++
    }

    // Check for zone overlaps
    for (const zone of layout.zones) {
      if (
        seat.position.x - halfW < zone.bounds.maxX &&
        seat.position.x + halfW > zone.bounds.minX &&
        seat.position.y - halfD < zone.bounds.maxY &&
        seat.position.y + halfD > zone.bounds.minY
      ) {
        seatOverlaps++
        break
      }
    }
  }

  if (outOfBounds > 0) {
    errors.push(`${outOfBounds} seats are positioned outside gym bounds`)
  }

  if (seatOverlaps > 0) {
    errors.push(`${seatOverlaps} seats overlap with blocked zones`)
  }

  // Check accessibility compliance
  const inaccessibleRatio =
    layout.stats.seatsByAccessibility.standard / layout.totalSeats
  if (inaccessibleRatio > 0.95) {
    warnings.push('Very few accessible seats - may not meet ADA requirements')
  }

  // Check utilization
  if (layout.utilizationRatio < 0.1) {
    warnings.push('Very low space utilization')
  } else if (layout.utilizationRatio > 0.8) {
    warnings.push('Very high space utilization - may feel cramped')
  }

  // Check density distribution
  let lastY = -Infinity
  const rowGaps: number[] = []

  const sortedSeats = [...layout.seats].sort((a, b) => a.position.y - b.position.y)

  for (const seat of sortedSeats) {
    if (Math.abs(seat.position.y - lastY) > 0.1) {
      if (lastY !== -Infinity) {
        rowGaps.push(seat.position.y - lastY)
      }
      lastY = seat.position.y
    }
  }

  if (rowGaps.length > 0) {
    const minGap = Math.min(...rowGaps)
    const maxGap = Math.max(...rowGaps)

    if (maxGap - minGap > 0.3) {
      warnings.push('Inconsistent row spacing - layout may look uneven')
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// ============================================================================
// Seat Conflict Detection
// ============================================================================

/**
 * Check if two seats are too close
 */
export function seatsConflict(seat1: Seat, seat2: Seat, minDistance: number = 0.1): boolean {
  const dist = distance2D(seat1.position, seat2.position)
  const minSpacing =
    (seat1.dimension.width + seat2.dimension.width) / 2 + minDistance

  return dist < minSpacing
}

/**
 * Find conflicting seat pairs in layout
 */
export function findConflictingSeats(layout: LayoutOutput): Array<[Seat, Seat]> {
  const conflicts: Array<[Seat, Seat]> = []

  for (let i = 0; i < layout.seats.length; i++) {
    for (let j = i + 1; j < layout.seats.length; j++) {
      const seat1 = layout.seats[i]
      const seat2 = layout.seats[j]

      if (seatsConflict(seat1, seat2)) {
        conflicts.push([seat1, seat2])
      }
    }
  }

  return conflicts
}

// ============================================================================
// Accessibility Compliance
// ============================================================================

/**
 * Check accessibility compliance ratios
 */
export function checkAccessibilityCompliance(
  layout: LayoutOutput
): {
  adaCompliant: boolean
  ratio: number
  recommended: number
  actual: number
} {
  const total = layout.totalSeats
  const accessible = layout.stats.seatsByAccessibility.accessible

  // 1 accessible seat per 25 total seats (rough ADA guideline)
  const recommended = Math.ceil(total / 25)
  const ratio = accessible / total

  return {
    adaCompliant: accessible >= recommended,
    ratio,
    recommended,
    actual: accessible
  }
}

// ============================================================================
// Fire Code Analysis
// ============================================================================

/**
 * Calculate aisle compliance
 */
export function checkAisleCompliance(config: GymConfig): {
  compliant: boolean
  minWidth: number
  actual: number
  message: string
} {
  // Fire codes typically require:
  // - Main aisles: 1.5m minimum
  // - Secondary aisles: 1m minimum
  // - Emergency exits: 1.1m minimum

  const minWidth = 1.5
  const actual = Math.max(
    config.aisles.side,
    config.aisles.front,
    config.aisles.back,
    config.aisles.carpet
  )

  return {
    compliant: actual >= minWidth,
    minWidth,
    actual,
    message:
      actual >= minWidth
        ? `Aisles meet fire code (${actual}m >= ${minWidth}m)`
        : `Aisles may not meet fire code (${actual}m < ${minWidth}m) - consult local regulations`
  }
}

// ============================================================================
// Export validation utilities
// ============================================================================

export function generateValidationReport(config: GymConfig, layout: LayoutOutput): string {
  const configValidation = validateConfig(config)
  const layoutValidation = validateLayout(layout, config)
  const accessibility = checkAccessibilityCompliance(layout)
  const aisles = checkAisleCompliance(config)

  return `
  ╔════════════════════════════════════════════════════════════════════╗
  ║                  GYM LAYOUT VALIDATION REPORT                      ║
  ╚════════════════════════════════════════════════════════════════════╝

  📊 CONFIGURATION VALIDATION
  ${configValidation.isValid ? '✅' : '❌'} Configuration is ${configValidation.isValid ? 'valid' : 'invalid'}
  ${configValidation.errors.map(e => `  ❌ ${e}`).join('\n')}
  ${configValidation.warnings.map(w => `  ⚠️  ${w}`).join('\n')}

  🎪 LAYOUT VALIDATION
  ${layoutValidation.isValid ? '✅' : '❌'} Layout is ${layoutValidation.isValid ? 'valid' : 'invalid'}
  ${layoutValidation.errors.map(e => `  ❌ ${e}`).join('\n')}
  ${layoutValidation.warnings.map(w => `  ⚠️  ${w}`).join('\n')}

  ♿ ACCESSIBILITY COMPLIANCE
  ${accessibility.adaCompliant ? '✅' : '⚠️'} ${accessibility.adaCompliant ? 'Compliant' : 'May not be compliant'} with ADA guidelines
     Recommended accessible seats: ${accessibility.recommended}
     Actual accessible seats: ${accessibility.actual}
     Ratio: ${(accessibility.ratio * 100).toFixed(1)}%

  🚪 FIRE CODE COMPLIANCE
  ${aisles.compliant ? '✅' : '⚠️'} ${aisles.message}

  📈 UTILIZATION METRICS
     Total seats: ${layout.totalSeats}
     Space utilization: ${(layout.utilizationRatio * 100).toFixed(1)}%
     Occupied area: ${layout.occupiedAreas.toFixed(2)} m²
  `
}
