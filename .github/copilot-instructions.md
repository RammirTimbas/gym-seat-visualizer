# Gym Seat Planner - Copilot Instructions

## Project Overview

A modular TypeScript/Vite application for generating and visualizing gymnasium seating layouts with real-world measurements. The architecture separates layout generation (pure algorithm) from rendering (2D Canvas), enabling future 3D rendering integration.

## Architecture Principles

- **Separation of Concerns**: Layout generation independent from rendering
- **Format-Agnostic Data Models**: Same `LayoutOutput` works for 2D, 3D, export formats
- **Type Safety**: Full TypeScript support with strict mode
- **Scalability**: O(n) layout generation, efficient Canvas rendering
- **Real-world Measurements**: All dimensions in meters with metric precision

## Key Files & Their Purpose

| File | Purpose |
|------|---------|
| `src/core/types.ts` | Type definitions (2D/3D agnostic) |
| `src/core/layoutGenerator.ts` | Core seat placement algorithm |
| `src/renderer/canvas2dRenderer.ts` | HTML5 Canvas renderer (fully decoupled) |
| `src/examples/predefinedConfigs.ts` | Predefined gym configurations |
| `src/main.ts` | App entry point & UI controller |
| `index.html` | HTML entry point |

## Development Commands

```bash
npm run dev          # Start dev server (Vite, port 3000)
npm run build        # Build for production
npm run type-check   # TypeScript validation
```

## Code Style Guidelines

1. **Modular Design**: Each module has single responsibility
2. **Pure Functions**: Prefer pure functions in layout generation
3. **Type Annotations**: Always specify types, use strict mode
4. **JSDoc Comments**: Document public APIs with examples
5. **No External Dependencies**: Core functionality requires none

## When to Add Code

### Layout Generation Enhancements
- File: `src/core/layoutGenerator.ts`
- Current algorithm: Grid-based row placement with zone reservation
- Optimization opportunities: Sightline analysis, density tuning, compliance checking

### New Rendering Features
- File: `src/renderer/canvas2dRenderer.ts`
- Current: 2D Canvas renderer
- Future: Create `src/renderer/three3dRenderer.ts` for 3D

### New Configurations
- File: `src/examples/predefinedConfigs.ts`
- Add stadium-specific or custom layouts

### UI/UX Improvements
- File: `src/main.ts`
- Enhance sidebar controls, add stats panels, improve interactivity

## Extending the System

### Adding a 3D Renderer

```typescript
// src/renderer/three3dRenderer.ts
import { LayoutOutput } from '../core/types'

export class Three3DRenderer {
  loadLayout(layout: LayoutOutput): void {
    // Same data model as 2D!
    // Convert 2D coordinates (x, y) to 3D (x, y, z)
  }
}
```

### Adding Optimization Strategy

```typescript
// src/core/optimalPlacement.ts
export function optimizeDensity(layout: LayoutOutput, targetDensity: number): LayoutOutput {
  // Adjust seat spacing while respecting constraints
}
```

### Adding Export Format

```typescript
// src/utils/exporters.ts
export function exportToGLTF(layout: LayoutOutput): string {
  // Convert layout to GLTF for 3D viewers
}
```

## Testing Strategy (Future)

```typescript
// tests/layoutGenerator.test.ts
describe('LayoutGenerator', () => {
  it('respects zone boundaries', () => {})
  it('calculates accessibility correctly', () => {})
  it('handles minimal constraints', () => {})
})
```

## Performance Targets

- Layout generation: <100ms for 2000 seats
- Canvas rendering: 60 FPS at any zoom/pan
- Memory: <100KB per 1000 seats

## Known Limitations & TODOs

- [ ] Bleacher tiering elevation calculations
- [ ] Sightline obstruction analysis
- [ ] Fire code compliance validation
- [ ] Multi-level arena support
- [ ] Real-time occupancy tracking
- [ ] Mobile-responsive UI refinement

## Configuration System

All layouts defined in `GymConfig` structure:

```typescript
{
  id: string
  name: string
  width/length/height: number (meters)
  seatTypes: [{ type, width, depth, height }]
  zones: [{ id, type, bounds }]
  aisleWidth: number
  seatSpacing: number
  rowSpacing: number
  minMargin: number
  maxRows: number
  preferredDensity: 'compact' | 'comfortable' | 'spacious'
}
```

## Real-world Constraints Handled

- ✓ Exact gym footprints
- ✓ Furniture dimensions
- ✓ ADA accessibility
- ✓ Aisle widths
- ✓ Comfort spacing
- ✓ Sightlines (basic)
- ⚠️ Fire codes (planned)
- ⚠️ Emergency egress (planned)

## Integration Points

The system can integrate with:
- Event management systems (via JSON export)
- 3D visualization platforms (via LayoutOutput data)
- Booking systems (occupancy overlay)
- CAD software (GLTF export)
- Analytics dashboards (utilization metrics)

---

*Last updated: 2024*
