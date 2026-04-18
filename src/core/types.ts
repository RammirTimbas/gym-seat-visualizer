/**
 * Core type definitions for the Gym Seat Planner system
 * Designed to be 2D/3D agnostic - supports both canvas and Three.js rendering
 */

// ============================================================================
// Geometric Types (2D - can be extended to 3D)
// ============================================================================

export interface Vector2 {
  x: number
  y: number
}

export interface Vector3 extends Vector2 {
  z: number
}

export interface Bounds2D {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Bounds3D extends Bounds2D {
  minZ: number
  maxZ: number
}

// ============================================================================
// Gymnasium Shape Types
// ============================================================================

export enum GymnasiumShape {
  RECTANGLE = 'rectangle',
  SQUARE = 'square',
  OVAL = 'oval',
  CIRCLE = 'circle'
}

// ============================================================================
// Bleacher Configuration
// ============================================================================

export interface BleacherConfig {
  enabled: boolean
  width: number // total bleacher footprint depth in meters
  numberOfSteps: number
  stepHeight: number // meters
  stepDepth: number // meters
  aisleCount: number
  entranceWidth: number
}

// ============================================================================
// Seat Types & Configuration
// ============================================================================

export enum SeatType {
  MONOBLOCK = 'monoblock',
  BLEACHER = 'bleacher'
}

export interface SeatTypeConfig {
  type: SeatType
  width: number // meters
  depth: number // meters
  height?: number // meters (optional, for 3D)
}

export interface SeatMetadata {
  id: string
  row: number
  position: number // position within the row
  type: SeatType
  accessible?: boolean // wheelchair accessible
  blocked?: boolean // unavailable for seating
  vip?: boolean
  occupied?: boolean // is seat occupied
  seatNumber?: string // readable seat number (e.g., "A-12")
  bleacher?: boolean // is seat in bleacher
}

// ============================================================================
// Seat Instance (Physical Seat in the Layout)
// ============================================================================

export interface Seat {
  id: string
  position: Vector2 // center position in meters
  dimension: SeatTypeConfig
  metadata: SeatMetadata
}

// ============================================================================
// Zones (Blocked Areas)
// ============================================================================

export enum ZoneType {
  STAGE = 'stage',
  VIP = 'vip',
  BLOCKED = 'blocked',
  AISLE = 'aisle',
  BLEACHER = 'bleacher'
}

export interface Zone {
  id: string
  type: ZoneType
  bounds: Bounds2D
  label?: string
}

// ============================================================================
// Gym Configuration
// ============================================================================

export interface GymConfig {
    /**
     * If set, the layout generator will try to allocate this many people (bleachers first, then floor)
     */
    targetPeople?: number
  id: string
  name: string
  
  // Shape and base dimensions
  shape: GymnasiumShape
  width: number // meters
  length: number // meters (depth)
  height?: number // meters (for 3D)
  
  seatTypes: SeatTypeConfig[]
  zones: Zone[]
  
  // Bleacher configuration
  bleachers?: BleacherConfig
  
  // Aisle configuration
  aisles: {
    side: number // width of each side aisle in meters
    front: number // width of the front aisle in meters
    back: number // width of the back aisle in meters
    carpet: number // width of the center red carpet in meters
  }
  
  // Spacing constraints
  horizontalSpacing: number // meters between seats in a row
  verticalSpacing: number // meters between rows
  minMargin: number // meters margin from walls/edges

  // Layout Controls
  fixedRows?: number // Optional: specify exact number of rows
  fixedSeatsPerRow?: number // Optional: specify exact number of seats per row

  // Optimization
  maxRows?: number
  preferredDensity?: 'compact' | 'comfortable' | 'spacious'
}

// ============================================================================
// Generated Layout Output
// ============================================================================

export interface LayoutOutput {
  configId: string
  timestamp: number
  
  // Metadata
  totalSeats: number
  occupiedSeats: number // number of occupied seats (if occupancy data provided)
  occupiedAreas: number // square meters occupied by people
  utilizationRatio: number // 0-1 (seats/totalSeats)
  warning?: string
  
  // Spatial data
  seats: Seat[]
  zones: Zone[]
  config?: GymConfig // Store config for renderer access
  
  // Statistics
  stats: {
    seatsByType: Record<SeatType, number>
    seatsByAccessibility: {
      accessible: number
      standard: number
    }
    seatsByCategory: {
      vip: number
      regular: number
    }
    seatsByOccupancy: {
      occupied: number
      empty: number
    }
    // Grid dimensions for floor layout
    rowCount?: number
    seatsPerRow?: number
  }
}

export interface LayoutAlert {
  title: string
  message: string
  tips?: string[]
}

// ============================================================================
// Rendering Context (Format-independent)
// ============================================================================

export interface RenderContext {
  scale: number // pixels per meter
  offsetX: number // canvas offset in pixels
  offsetY: number // canvas offset in pixels
  width: number // render width in pixels
  height: number // render height in pixels
}

export interface RenderOptions {
  showGrid?: boolean
  showLabels?: boolean
  showZones?: boolean
  showAisles?: boolean
  highlightAccessible?: boolean
  showLegend?: boolean
  showWarnings?: boolean
  showMeasurements?: boolean // Show gym/stage/seat dimensions
  showOccupancy?: boolean // Color code seats by occupancy
  showUtilization?: boolean // Show utilization heat map
  hideEmptySeats?: boolean // Hide seats that are not occupied
  theme?: 'light' | 'dark'
}

// ============================================================================
// Export all types
// ============================================================================

export type SeatFilter = Partial<SeatMetadata> & {
  type?: SeatType
  accessible?: boolean
  vip?: boolean
  blocked?: boolean
}
