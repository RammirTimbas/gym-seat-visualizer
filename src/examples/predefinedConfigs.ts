/**
 * Predefined Gym Configurations
 * Ready-to-use examples of different gymnasium layouts
 */

import { GymConfig, SeatType, ZoneType, GymnasiumShape } from '../core/types'

/**
 * Small indoor gym (e.g., community or school gym)
 * 20m x 15m layout
 */
export const SMALL_GYM_CONFIG: GymConfig = {
  id: 'small-gym',
  name: 'Small Community Gym',
  shape: GymnasiumShape.RECTANGLE,
  width: 20,
  length: 15,
  height: 6,

  seatTypes: [
    {
      type: SeatType.MONOBLOCK,
      width: 0.5,
      depth: 0.5,
      height: 0.4
    }
  ],

  zones: [
    {
      id: 'stage',
      type: ZoneType.STAGE,
      bounds: {
        minX: 2,
        minY: 0.5,
        maxX: 18,
        maxY: 3
      },
      label: 'Stage/Court'
    }
  ],

  aisles: {
    horizontal: 1,
    vertical: 1,
    width: 1
  },

  bleachers: {
    enabled: false,
    width: 2,
    numberOfSteps: 4,
    stepHeight: 0.35,
    stepDepth: 0.6,
    aisleCount: 2,
    entranceWidth: 2
  },

  seatSpacing: 0.1,
  rowSpacing: 0.3,
  minMargin: 0.5,
  maxRows: 8,
  preferredDensity: 'comfortable'
}

/**
 * Medium gymnasium (e.g., university gym)
 * 40m x 25m layout
 */
export const MEDIUM_GYM_CONFIG: GymConfig = {
  id: 'medium-gym',
  name: 'Medium University Gym',
  shape: GymnasiumShape.RECTANGLE,
  width: 40,
  length: 25,
  height: 8,

  seatTypes: [
    {
      type: SeatType.MONOBLOCK,
      width: 0.55,
      depth: 0.55,
      height: 0.45
    }
  ],

  zones: [
    {
      id: 'stage',
      type: ZoneType.STAGE,
      bounds: {
        minX: 2,
        minY: 1,
        maxX: 38,
        maxY: 6
      },
      label: 'Court/Stage'
    }
  ],

  aisles: {
    horizontal: 2,
    vertical: 1,
    width: 1.5
  },

  bleachers: {
    enabled: true,
    width: 3,
    numberOfSteps: 5,
    stepHeight: 0.35,
    stepDepth: 0.6,
    aisleCount: 3,
    entranceWidth: 3
  },

  seatSpacing: 0.15,
  rowSpacing: 0.35,
  minMargin: 1,
  maxRows: 12,
  preferredDensity: 'comfortable'
}

/**
 * Large arena (e.g., professional sports venue)
 * 80m x 60m layout with multiple sections
 */
export const LARGE_ARENA_CONFIG: GymConfig = {
  id: 'large-arena',
  name: 'Large Professional Arena',
  shape: GymnasiumShape.OVAL,
  width: 80,
  length: 60,
  height: 12,

  seatTypes: [
    {
      type: SeatType.MONOBLOCK,
      width: 0.5,
      depth: 0.5,
      height: 0.4
    }
  ],

  zones: [
    {
      id: 'stage',
      type: ZoneType.STAGE,
      bounds: {
        minX: 30,
        minY: 20,
        maxX: 50,
        maxY: 40
      },
      label: 'Court/Stage'
    }
  ],

  aisles: {
    horizontal: 3,
    vertical: 2,
    width: 2
  },

  bleachers: {
    enabled: true,
    width: 4,
    numberOfSteps: 8,
    stepHeight: 0.35,
    stepDepth: 0.6,
    aisleCount: 4,
    entranceWidth: 4
  },

  seatSpacing: 0.12,
  rowSpacing: 0.3,
  minMargin: 1.5,
  maxRows: 20,
  preferredDensity: 'compact'
}

/**
 * Circular amphitheater
 */
export const CIRCULAR_AMPHITHEATER_CONFIG: GymConfig = {
  id: 'circular-amphitheater',
  name: 'Circular Amphitheater',
  shape: GymnasiumShape.CIRCLE,
  width: 50,
  length: 50,
  height: 8,

  seatTypes: [
    {
      type: SeatType.MONOBLOCK,
      width: 0.48,
      depth: 0.48,
      height: 0.4
    }
  ],

  zones: [
    {
      id: 'stage',
      type: ZoneType.STAGE,
      bounds: {
        minX: 20,
        minY: 20,
        maxX: 30,
        maxY: 30
      },
      label: 'Performance Area'
    }
  ],

  aisles: {
    horizontal: 2,
    vertical: 2,
    width: 1.2
  },

  bleachers: {
    enabled: false,
    width: 2,
    numberOfSteps: 6,
    stepHeight: 0.35,
    stepDepth: 0.6,
    aisleCount: 2,
    entranceWidth: 3
  },

  seatSpacing: 0.1,
  rowSpacing: 0.25,
  minMargin: 1,
  maxRows: 15,
  preferredDensity: 'comfortable'
}

/**
 * Get all predefined configurations
 */
export function getAllConfigs(): GymConfig[] {
  return [SMALL_GYM_CONFIG, MEDIUM_GYM_CONFIG, LARGE_ARENA_CONFIG, CIRCULAR_AMPHITHEATER_CONFIG]
}

/**
 * Get configuration by ID
 */
export function getConfigById(id: string): GymConfig | undefined {
  return getAllConfigs().find(config => config.id === id)
}

/**
 * Export configuration as JSON for storage/sharing
 */
export function exportConfig(config: GymConfig): string {
  return JSON.stringify(config, null, 2)
}

/**
 * Import configuration from JSON
 */
export function importConfig(jsonString: string): GymConfig {
  try {
    return JSON.parse(jsonString) as GymConfig
  } catch (error) {
    throw new Error(`Failed to parse configuration: ${error}`)
  }
}
