/**
 * Geometry and Math Utilities
 * Helper functions for calculations and spatial operations
 */

import { Vector2, Vector3, Bounds2D, Bounds3D } from '../core/types'

// ============================================================================
// 2D Geometry
// ============================================================================

/**
 * Calculate distance between two 2D points
 */
export function distance2D(p1: Vector2, p2: Vector2): number {
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Check if point is within bounds
 */
export function pointInBounds(point: Vector2, bounds: Bounds2D): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

/**
 * Check if two rectangular regions overlap
 */
export function boundsOverlap(b1: Bounds2D, b2: Bounds2D): boolean {
  return !(b1.maxX < b2.minX || b1.minX > b2.maxX || b1.maxY < b2.minY || b1.minY > b2.maxY)
}

/**
 * Calculate area of bounds
 */
export function boundsArea(bounds: Bounds2D): number {
  return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
}

/**
 * Calculate center of bounds
 */
export function boundsCentre(bounds: Bounds2D): Vector2 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  }
}

/**
 * Expand bounds by a margin
 */
export function expandBounds(bounds: Bounds2D, margin: number): Bounds2D {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin
  }
}

// ============================================================================
// 3D Geometry
// ============================================================================

/**
 * Calculate distance between two 3D points
 */
export function distance3D(p1: Vector3, p2: Vector3): number {
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  const dz = p1.z - p2.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Check if point is within 3D bounds
 */
export function pointInBounds3D(point: Vector3, bounds: Bounds3D): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  )
}

/**
 * Convert 2D bounds to 3D (with height)
 */
export function expand2DTo3D(bounds: Bounds2D, minZ: number, maxZ: number): Bounds3D {
  return {
    ...bounds,
    minZ,
    maxZ
  }
}

// ============================================================================
// Angle & Rotation
// ============================================================================

/**
 * Convert degrees to radians
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Convert radians to degrees
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

/**
 * Calculate angle between two points
 */
export function angleBetweenPoints(p1: Vector2, p2: Vector2): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x)
}

/**
 * Rotate point around origin
 */
export function rotatePoint(
  point: Vector2,
  origin: Vector2,
  angleRadians: number
): Vector2 {
  const cos = Math.cos(angleRadians)
  const sin = Math.sin(angleRadians)
  const x = point.x - origin.x
  const y = point.y - origin.y

  return {
    x: origin.x + x * cos - y * sin,
    y: origin.y + x * sin + y * cos
  }
}

// ============================================================================
// Linear Interpolation & Scaling
// ============================================================================

/**
 * Linear interpolation between two values
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Linear interpolation between two points
 */
export function lerpPoint(p1: Vector2, p2: Vector2, t: number): Vector2 {
  return {
    x: lerp(p1.x, p2.x, t),
    y: lerp(p1.y, p2.y, t)
  }
}

/**
 * Map value from one range to another
 */
export function mapValue(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ============================================================================
// Grid & Discretization
// ============================================================================

/**
 * Snap point to grid
 */
export function snapToGrid(point: Vector2, gridSize: number): Vector2 {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize
  }
}

/**
 * Convert meters to pixels with scale
 */
export function metersToPixels(meters: number, scale: number): number {
  return meters * scale
}

/**
 * Convert pixels to meters with scale
 */
export function pixelsToMeters(pixels: number, scale: number): number {
  return pixels / scale
}

// ============================================================================
// Polygon Utils (for future sightline analysis)
// ============================================================================

/**
 * Check if point is inside polygon using ray casting
 */
export function pointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y

    const intersect =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi

    if (intersect) {
      inside = !inside
    }
  }

  return inside
}

/**
 * Check if point is inside an oval/ellipse
 */
export function pointInOval(
  px: number,
  py: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number
): boolean {
  const dx = px - centerX
  const dy = py - centerY
  return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1
}
