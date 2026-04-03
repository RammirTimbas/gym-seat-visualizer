/**
 * Main entry point for the Gym Seat Planner
 * Demonstrates the complete workflow
 */

import { generateLayout } from './core/layoutGenerator'
import { Canvas2DRenderer } from './renderer/canvas2dRenderer'
import { GymConfig, LayoutAlert, LayoutOutput, GymnasiumShape, SeatType } from './core/types'

// App state
interface AppState {
  currentConfig: GymConfig | null
  latestLayout: LayoutOutput | null
  renderer: Canvas2DRenderer | null
}

const state: AppState = {
  currentConfig: null,
  latestLayout: null,
  renderer: null
}

/**
 * Initialize the application
 */
export function initializeApp(): void {
  setupDOM()
  setupEventListeners()
  // Initialize empty canvas with renderer
  const canvas = document.getElementById('seating-canvas') as HTMLCanvasElement
  if (canvas) {
    state.renderer = new Canvas2DRenderer(canvas, {
      showGrid: true,
      showLabels: true,
      showZones: true,
      showLegend: true,
      showAisles: true,
      showWarnings: true,
      highlightAccessible: true,
      theme: 'light'
    })
  }
}

/**
 * Setup DOM elements
 */
function setupDOM(): void {
  // ...existing code...
    // Add loading overlay
    const loadingDiv = document.createElement('div')
    loadingDiv.id = 'loading-overlay'
    loadingDiv.style.cssText = 'display:none;position:fixed;z-index:1000;top:0;left:0;width:100vw;height:100vh;background:rgba(255,255,255,0.7);align-items:center;justify-content:center;font-size:2rem;color:#374151;font-weight:bold;backdrop-filter:blur(2px);'
    loadingDiv.innerHTML = '<span>⏳ Generating layout...</span>'
    document.body.appendChild(loadingDiv)
  const appContainer = document.getElementById('app')
  if (!appContainer) {
    console.error('App container not found')
    return
  }

  appContainer.innerHTML = `
    <div class="app-wrapper">
      <header class="app-header">
        <h5>CNSC Gymnasium Seat Allocation  Visualization</h5>
      </header>

      <div class="app-main">
        <aside class="app-sidebar">
          <section class="error-panel" id="error-panel" style="display:none; background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; border-radius:6px; padding:10px; margin-bottom:16px;"></section>
          <section class="control-panel">
            <h2>Controls</h2>
            <div class="control-group">
              <label>Stage Size (meters):</label>
              <div style="display:flex; gap:8px;">
                <input id="input-stage-width" type="number" min="1" step="0.1" placeholder="Width" style="width:70px;" />
                <input id="input-stage-length" type="number" min="1" step="0.1" placeholder="Length" style="width:70px;" />
              </div>
            </div>
              <div class="control-group">
                <label for="target-people">Target People (occupancy):</label>
                <input id="target-people" type="number" min="0" step="1" placeholder="Auto" style="width:100px;" />
              </div>




            <div class="control-group">
              <label>Gym Dimensions (meters):</label>
              <div style="display:flex; gap:8px;">
                <input id="input-width" type="number" min="1" step="0.1" placeholder="Width" style="width:70px;" />
                <input id="input-length" type="number" min="1" step="0.1" placeholder="Length" style="width:70px;" />
                <input id="input-height" type="number" min="1" step="0.1" placeholder="Height" style="width:70px;" />
              </div>
            </div>

            <div class="control-group">
              <label for="input-seat-size">Seat Size (meters):</label>
              <input id="input-seat-size" type="number" min="0.2" step="0.05" placeholder="Seat size" style="width:100px;" />
            </div>

            <div class="control-group">
              <label for="input-seat-spacing">Seat Spacing (meters):</label>
              <input id="input-seat-spacing" type="number" min="0" step="0.05" placeholder="Seat spacing" style="width:100px;" />
            </div>

            <div class="control-group">
              <label for="shape-select">Gym Shape:</label>
              <select id="shape-select">
                <option value="rectangle">Rectangle</option>
                <option value="square">Square</option>
                <option value="oval">Oval</option>
                <option value="circle">Circle</option>
              </select>
            </div>

            <div class="control-group">
              <label>Aisles:</label>
              <div style="display:flex; gap:8px;">
                <input id="input-aisle-h" type="number" min="0" step="1" placeholder="Horizontal" style="width:60px;" />
                <input id="input-aisle-v" type="number" min="0" step="1" placeholder="Vertical" style="width:60px;" />
                <input id="input-aisle-width" type="number" min="0.5" step="0.1" placeholder="Width (m)" style="width:80px;" />
              </div>
            </div>

            <div class="control-group">
              <label>Bleachers:</label>
              <div style="display:flex; align-items:center; gap:8px;">
                <input id="bleachers-enabled" type="checkbox" /> Enable
              </div>
              <div style="display:flex; gap:8px; margin-top:6px;">
                <input id="bleachers-steps" type="number" min="1" step="1" placeholder="# Steps" style="width:60px;" />
                <input id="bleachers-aisles" type="number" min="0" step="1" placeholder="# Aisles" style="width:70px;" />
                <input id="bleachers-width" type="number" min="0.5" step="0.1" placeholder="Depth (m)" style="width:80px;" />
                <input id="bleachers-entrance-width" type="number" min="0.5" step="0.1" placeholder="Entrance (m)" style="width:92px;" />
              </div>
            </div>
            <div class="button-group">
              <button id="btn-regenerate">Generate Layout</button>
              <button id="btn-export">Export Config</button>
              <button id="btn-import">Import Config</button>
              <input id="file-import" type="file" accept=".json" style="display:none;" />
            </div>

            <div class="control-group">
              <h3>Render Options</h3>
              <label>
                <input type="checkbox" id="show-grid" checked /> Show Grid
              </label>
              <label>
                <input type="checkbox" id="show-measurements" checked /> Show Measurements
              </label>
              <label>
                <input type="checkbox" id="show-labels" checked /> Show Labels
              </label>
              <label>
                <input type="checkbox" id="show-zones" checked /> Show Zones
              </label>
              <label>
                <input type="checkbox" id="show-legend" checked /> Show Legend
              </label>
              <label>
                <input type="checkbox" id="show-warnings" checked /> Show Warnings
              </label>  
            </div>

            <div class="control-group">
              <h3>Zoom & Pan</h3>
              <div class="zoom-controls">
                <button id="btn-zoom-in">🔍+ Zoom In</button>
                <button id="btn-zoom-out">🔍- Zoom Out</button>
              </div>
              <p class="help-text">Use mouse wheel or trackpad to zoom. Drag to pan.</p>
            </div>

            <div class="stats-panel">
              <h3>Layout Statistics</h3>
              <div id="stats-container">
                <p>Load a layout to see statistics</p>
              </div>
            </div>
            <div class="stats-panel">
              <h3>Measurements</h3>
              <div id="measurements-container">
                <p>Load a layout to see measurements</p>
              </div>
            </div>
          </section>
        </aside>

        <main class="app-content">
          <div id="canvas-container" class="canvas-container">
            <canvas id="seating-canvas"></canvas>
          </div>
        </main>
      </div>

      <footer class="app-footer">
        <p>Gym Seat Planner v1.0 | Designed for 2D/3D transitions | Real-world measurements</p>
      </footer>
    </div>
  `

  // Add styles
  const style = document.createElement('style')
  style.textContent = getStyles()
  document.head.appendChild(style)
}

/**
 * Setup event listeners
 */
function setupEventListeners(): void {
  document.getElementById('show-measurements')?.addEventListener('change', (e) => {
    if (state.renderer) {
      state.renderer.setRenderOptions({ showMeasurements: (e.target as HTMLInputElement).checked })
    }
  })


  // Only update config on Regenerate button click
  document.getElementById('btn-regenerate')?.addEventListener('click', () => {
    updateConfigFromInputs()
  })

  // Occupancy slider label
  const occSlider = document.getElementById('occupancy-slider') as HTMLInputElement
  const occValue = document.getElementById('occupancy-value') as HTMLElement
  if (occSlider && occValue) {
    occSlider.addEventListener('input', () => {
      occValue.textContent = occSlider.value
    })
  }

  document.getElementById('btn-reset-view')?.addEventListener('click', () => {
    if (state.renderer) {
      state.renderer.resetView()
    }
  })

  document.getElementById('btn-export')?.addEventListener('click', () => {
    if (state.renderer) {
      const json = state.renderer.exportJSON()
      downloadJSON(json, `gym-layout-${Date.now()}.json`)
    }
  })

  document.getElementById('btn-import')?.addEventListener('click', () => {
    const fileInput = document.getElementById('file-import') as HTMLInputElement
    fileInput?.click()
  })

  document.getElementById('file-import')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) {
      importJSONFile(file)
      // Reset input so same file can be imported again if needed
      ;(e.target as HTMLInputElement).value = ''
    }
  })

  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    if (state.renderer) {
      state.renderer.zoom(1.2)
    }
  })

  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    if (state.renderer) {
      state.renderer.zoom(0.8)
    }
  })

  // Render options
  document.getElementById('show-grid')?.addEventListener('change', (e) => {
    if (state.renderer) {
      state.renderer.setRenderOptions({ showGrid: (e.target as HTMLInputElement).checked })
    }
  })

  document.getElementById('show-labels')?.addEventListener('change', (e) => {
    if (state.renderer) {
      state.renderer.setRenderOptions({ showLabels: (e.target as HTMLInputElement).checked })
    }
  })

  document.getElementById('show-zones')?.addEventListener('change', (e) => {
    if (state.renderer) {
      state.renderer.setRenderOptions({ showZones: (e.target as HTMLInputElement).checked })
    }
  })

  document.getElementById('show-legend')?.addEventListener('change', (e) => {
    if (state.renderer) {
      state.renderer.setRenderOptions({ showLegend: (e.target as HTMLInputElement).checked })
    }
  })

  document.getElementById('show-warnings')?.addEventListener('change', (e) => {
    if (state.renderer) {
      state.renderer.setRenderOptions({ showWarnings: (e.target as HTMLInputElement).checked })
    }
  })

  document.getElementById('highlight-accessible')?.addEventListener('change', (e) => {
    if (state.renderer) {
      state.renderer.setRenderOptions({
        highlightAccessible: (e.target as HTMLInputElement).checked
      })
    }
  })

  // Canvas interactions
  const canvas = document.getElementById('seating-canvas') as HTMLCanvasElement
  if (canvas) {
    let isMouseDown = false
    let lastX = 0
    let lastY = 0

    canvas.addEventListener('mousedown', (e) => {
      isMouseDown = true
      lastX = e.clientX
      lastY = e.clientY
    })

    canvas.addEventListener('mousemove', (e) => {
      if (isMouseDown && state.renderer) {
        const deltaX = e.clientX - lastX
        const deltaY = e.clientY - lastY
        state.renderer.pan(deltaX, deltaY)
        lastX = e.clientX
        lastY = e.clientY
      }
    })

    canvas.addEventListener('mouseup', () => {
      isMouseDown = false
    })

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (state.renderer) {
        const factor = e.deltaY > 0 ? 0.9 : 1.1
        state.renderer.zoom(factor)
      }
    })
  }
}

/**
 * Load and render a gym layout
 */
function loadLayout(config: GymConfig): void {
  state.currentConfig = config
  setInputsFromConfig(config)

  // Show loading overlay
  const loadingDiv = document.getElementById('loading-overlay') as HTMLElement
  if (loadingDiv) loadingDiv.style.display = 'flex'

  const renderFlow = () => {
    let layout: any = null
    let layoutError = ''
    let layoutWarning = ''
    let layoutAlert: LayoutAlert | null = null

    try {
      layout = generateLayout(config)
    } catch (e: any) {
      // If error is dense/too large, try to shrink row count and retry
      if ((e?.message || '').includes('Layout too dense')) {
        let maxRows = config.maxRows || 100
        let found = false
        while (maxRows > 0 && !found) {
          try {
            config.maxRows = maxRows
            layout = generateLayout(config)
            found = true
          } catch {
            maxRows--
          }
        }
        if (found && layout) {
          const requested = parseInt((document.getElementById('target-people') as HTMLInputElement)?.value || '0', 10)
          const notAccommodated = (!isNaN(requested) && requested > 0) ? (requested - layout.seats.length) : 0
          layoutWarning = `⚠️ Only ${layout.seats.length} people can be accommodated in this gym. ${requested || ''} requested.`
          if (notAccommodated > 0) {
            layoutWarning += ` <b>${notAccommodated} not accommodated.</b>`
          }
        } else {
          layoutError = e?.message || 'Unknown error during layout generation.'
          layout = null
        }
      } else {
        layoutError = e?.message || 'Unknown error during layout generation.'
        layout = null
      }
    }

    if (!layoutError && layout?.warning) {
      layoutWarning = layout.warning
    }

    // Target people occupancy fills as many seats as requested (or all available if > available)
    if (layout) {
      const targetPeopleInput = document.getElementById('target-people') as HTMLInputElement
      let targetPeopleVal = targetPeopleInput ? parseInt(targetPeopleInput.value, 10) : NaN
      if (isNaN(targetPeopleVal) || targetPeopleVal <= 0) {
        targetPeopleVal = layout.seats.length
      }
      const n = Math.min(layout.seats.length, targetPeopleVal)
      const indices = Array.from({ length: layout.seats.length }, (_, i) => i)
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[indices[i], indices[j]] = [indices[j], indices[i]]
      }
      layout.seats.forEach((s: any) => {
        s.metadata.occupied = false
      })
      for (let i = 0; i < n; i++) {
        layout.seats[indices[i]].metadata.occupied = true
      }
      layout.stats.seatsByOccupancy.occupied = n
      layout.stats.seatsByOccupancy.empty = layout.seats.length - n
      layout.occupiedSeats = n
      layout.utilizationRatio = layout.seats.length > 0 ? n / layout.seats.length : 0
      if (targetPeopleVal > layout.seats.length) {
        layoutWarning = `⚠️ Only ${layout.seats.length} people are accommodated; requested ${targetPeopleVal}.`
      }
    }

    if (layoutWarning && layout) {
      layout.warning = layoutWarning.replace(/<[^>]+>/g, '')
      layoutAlert = buildLayoutAlert(layoutWarning, config, layout, getRequestedPeople())
    }

    // Target people handled above with occupancy fill; no extra seat removal needed
    // Initialize renderer if needed
    if (!state.renderer) {
      const canvas = document.getElementById('seating-canvas') as HTMLCanvasElement
      if (canvas) {
        state.renderer = new Canvas2DRenderer(canvas, {
          showGrid: true,
          showLabels: true,
          showZones: true,
          showLegend: true,
          showAisles: true,
          showWarnings: true,
          highlightAccessible: true,
          theme: 'light'
        })
      }
    }

    // Load layout in renderer
    if (state.renderer && layout) {
      state.renderer.loadLayout(layout)
      state.renderer.setLayoutAlert(layoutAlert)
    } else if (state.renderer) {
      state.renderer.setLayoutAlert(null)
    }

    // Update statistics
    if (layout) updateStats(layout)

    // Show feasibility or error warning if needed
    const errorPanel2 = document.getElementById('error-panel') as HTMLElement
    if (layoutError) {
      errorPanel2.style.display = 'block'
      errorPanel2.innerHTML = `<b>Layout Error:</b> ${layoutError}`
    } else if (errorPanel2) {
      errorPanel2.style.display = 'none'
      errorPanel2.innerHTML = ''
    }

    // Save latest layout to state
    if (layout) {
      state.latestLayout = layout
    }

    // Update stats with latest layout or partial
    const layoutToRender = state.latestLayout || layout
    if (state.renderer && layoutToRender) {
      state.renderer.loadLayout(layoutToRender)
    }

    if (layoutToRender) {
      updateStats(layoutToRender)
    }

    // Hide loading overlay once rendering done
    if (loadingDiv) loadingDiv.style.display = 'none'
  }

  window.requestAnimationFrame(() => setTimeout(renderFlow, 20))
}

function getRequestedPeople(): number | null {
  const targetPeopleInput = document.getElementById('target-people') as HTMLInputElement | null
  if (!targetPeopleInput) return null

  const requested = parseInt(targetPeopleInput.value, 10)
  return Number.isNaN(requested) || requested <= 0 ? null : requested
}

function buildLayoutAlert(
  warningMessage: string,
  config: GymConfig,
  layout: LayoutOutput,
  requestedPeople: number | null
): LayoutAlert {
  const tips: string[] = []
  const seatSize = config.seatTypes?.[0]?.width ?? 0.5

  if (requestedPeople && requestedPeople > layout.seats.length) {
    tips.push(`Decrease seat spacing below ${config.seatSpacing.toFixed(2)}m.`)
    tips.push(`Decrease seat size below ${seatSize.toFixed(2)}m if the actual chairs allow it.`)

    if (config.aisles.width > 0.5) {
      tips.push(`Reduce aisle width below ${config.aisles.width.toFixed(2)}m if your requirements permit it.`)
    }

    if ((config.zones || []).some((zone: any) => zone.type === 'stage')) {
      tips.push('Reduce the stage footprint or reclaim stage-adjacent space.')
    }

    if (config.bleachers?.enabled) {
      tips.push('Increase bleacher depth, reduce bleacher aisles, or add more bleacher steps.')
    }
  } else {
    tips.push(`Decrease seat spacing below ${config.seatSpacing.toFixed(2)}m for a denser plan.`)
    tips.push('Lower the target people count if the current clearances must stay the same.')
  }

  return {
    title: 'Layout Warning',
    message: warningMessage.replace(/<[^>]+>/g, ''),
    tips: tips.slice(0, 4)
  }
}

// Set sidebar input fields from config
function setInputsFromConfig(config: any): void {
  (document.getElementById('input-width') as HTMLInputElement).value = config.width
  ;(document.getElementById('input-length') as HTMLInputElement).value = config.length
  ;(document.getElementById('input-height') as HTMLInputElement).value = config.height || ''
  ;(document.getElementById('input-seat-size') as HTMLInputElement).value = config.seatTypes?.[0]?.width || ''
  ;(document.getElementById('input-seat-spacing') as HTMLInputElement).value = config.seatSpacing ?? ''
  ;(document.getElementById('shape-select') as HTMLSelectElement).value = config.shape
  ;(document.getElementById('input-aisle-h') as HTMLInputElement).value = config.aisles.horizontal
  ;(document.getElementById('input-aisle-v') as HTMLInputElement).value = config.aisles.vertical
  ;(document.getElementById('input-aisle-width') as HTMLInputElement).value = config.aisles.width
  ;(document.getElementById('bleachers-enabled') as HTMLInputElement).checked = config.bleachers?.enabled || false
  ;(document.getElementById('bleachers-steps') as HTMLInputElement).value = config.bleachers?.numberOfSteps || ''
  ;(document.getElementById('bleachers-aisles') as HTMLInputElement).value = config.bleachers?.aisleCount ?? 0
  ;(document.getElementById('bleachers-width') as HTMLInputElement).value = config.bleachers?.width || ''
  ;(document.getElementById('bleachers-entrance-width') as HTMLInputElement).value = config.bleachers?.entranceWidth ?? 2.5
  // Set stage dimensions from zones
  const stage = config.zones?.find((z: any) => z.type === 'stage')
  if (stage) {
    const stageWidth = stage.bounds.maxX - stage.bounds.minX
    const stageLength = stage.bounds.maxY - stage.bounds.minY
    ;(document.getElementById('input-stage-width') as HTMLInputElement).value = stageWidth.toFixed(2)
    ;(document.getElementById('input-stage-length') as HTMLInputElement).value = stageLength.toFixed(2)
  } else {
    ;(document.getElementById('input-stage-width') as HTMLInputElement).value = ''
    ;(document.getElementById('input-stage-length') as HTMLInputElement).value = ''
  }
  // Set target values if available in config
  ;(document.getElementById('target-people') as HTMLInputElement).value = config.targetPeople ? String(config.targetPeople) : ''
}

// Build config from sidebar input fields and regenerate layout
function updateConfigFromInputs(): void {
  // Collect errors
  const errors: string[] = [];
  // Build config from scratch (no preset)
  let config: any = {
    id: 'custom',
    name: 'Custom Gym',
    shape: (document.getElementById('shape-select') as HTMLSelectElement).value as GymnasiumShape,
    width: 20,
    length: 15,
    height: 6,
    seatTypes: [
      { type: SeatType.MONOBLOCK, width: 0.5, depth: 0.5, height: 0.4 }
    ],
    zones: [],
    aisles: { horizontal: 1, vertical: 1, width: 1 },
    bleachers: { enabled: false, width: 2, numberOfSteps: 4, stepHeight: 0.35, stepDepth: 0.6, aisleCount: 2, entranceWidth: 2.5 },
    seatSpacing: 0.1,
    rowSpacing: 0.3,
    minMargin: 0.5,
    preferredDensity: 'comfortable'
  }

  // Target people
  const targetPeopleInput = document.getElementById('target-people') as HTMLInputElement
  let targetPeopleVal = targetPeopleInput ? parseInt(targetPeopleInput.value, 10) : NaN
  if (!isNaN(targetPeopleVal) && targetPeopleVal > 0) {
    config.targetPeople = targetPeopleVal
  }

  // Parse gym dimensions from input and assign to config before stage validation
  const width = parseFloat((document.getElementById('input-width') as HTMLInputElement).value)
  const length = parseFloat((document.getElementById('input-length') as HTMLInputElement).value)
  const height = parseFloat((document.getElementById('input-height') as HTMLInputElement).value)
  const seatSize = parseFloat((document.getElementById('input-seat-size') as HTMLInputElement).value)
  const seatSpacing = parseFloat((document.getElementById('input-seat-spacing') as HTMLInputElement).value)
  config.width = width
  config.length = length
  config.height = height

  // Stage size - optional
  const stageWidth = parseFloat((document.getElementById('input-stage-width') as HTMLInputElement).value)
  const stageLength = parseFloat((document.getElementById('input-stage-length') as HTMLInputElement).value)
  const hasStageInputs = !isNaN(stageWidth) && stageWidth > 0 && !isNaN(stageLength) && stageLength > 0
  
  if (hasStageInputs) {
    if (stageWidth > config.width - 2 * config.minMargin) errors.push('Stage width must fit within gym width')
    if (stageLength > config.length - 2 * config.minMargin) errors.push('Stage length must fit within gym length')
    if (errors.length === 0) {
      config.zones.push({
        id: 'stage',
        type: 'stage',
        label: 'Stage',
        bounds: {
          minX: (config.width - stageWidth) / 2,
          maxX: (config.width + stageWidth) / 2,
          minY: config.minMargin,
          maxY: config.minMargin + stageLength
        }
      })
    }
  }

  // Note: We don't cap targetPeople here - let layout generation and occupancy filling handle constraints

  // (width, length, height already parsed and assigned above)
  const shape = (document.getElementById('shape-select') as HTMLSelectElement).value
  const aisleH = parseInt((document.getElementById('input-aisle-h') as HTMLInputElement).value, 10)
  const aisleV = parseInt((document.getElementById('input-aisle-v') as HTMLInputElement).value, 10)
  const aisleWidth = parseFloat((document.getElementById('input-aisle-width') as HTMLInputElement).value)
  const bleachersEnabled = (document.getElementById('bleachers-enabled') as HTMLInputElement).checked
  const bleachersSteps = parseInt((document.getElementById('bleachers-steps') as HTMLInputElement).value, 10)
  const bleachersAisles = parseInt((document.getElementById('bleachers-aisles') as HTMLInputElement).value, 10)
  const bleachersWidth = parseFloat((document.getElementById('bleachers-width') as HTMLInputElement).value)
  const bleachersEntranceWidth = parseFloat((document.getElementById('bleachers-entrance-width') as HTMLInputElement).value)

  // (errors already declared at top)
  if (isNaN(width) || width <= 0) errors.push('Width must be a positive number')
  if (isNaN(length) || length <= 0) errors.push('Length must be a positive number')
  if (height && (isNaN(height) || height <= 0)) errors.push('Height must be positive if specified')
  if (isNaN(seatSize) || seatSize < 0.2) errors.push('Seat size must be at least 0.2m')
  if (isNaN(seatSpacing) || seatSpacing < 0) errors.push('Seat spacing must be 0 or more')
  if (!['rectangle','square','oval','circle'].includes(shape)) errors.push('Invalid shape')
  if (isNaN(aisleH) || aisleH < 0) errors.push('Horizontal aisles must be 0 or more')
  if (isNaN(aisleV) || aisleV < 0) errors.push('Vertical aisles must be 0 or more')
  if (isNaN(aisleWidth) || aisleWidth < 0.5) errors.push('Aisle width must be at least 0.5m')
  if (bleachersEnabled) {
    if (isNaN(bleachersSteps) || bleachersSteps < 1) errors.push('Bleacher steps must be 1 or more')
    if (isNaN(bleachersAisles) || bleachersAisles < 0) errors.push('Bleacher aisles must be 0 or more')
    if (isNaN(bleachersWidth) || bleachersWidth < 0.5) errors.push('Bleacher depth must be at least 0.5m')
    if (isNaN(bleachersEntranceWidth) || bleachersEntranceWidth < 0.5) errors.push('Bleacher entrance width must be at least 0.5m')
    if (!isNaN(width) && bleachersWidth >= width / 2) errors.push('Bleacher depth must leave usable floor space')
    if (!isNaN(width) && bleachersEntranceWidth >= width - 2 * config.minMargin) errors.push('Bleacher entrance width is too wide for the gym')
  }

  // Show/hide error panel
  const errorPanel = document.getElementById('error-panel') as HTMLElement
  if (errors.length > 0) {
    errorPanel.style.display = 'block'
    errorPanel.innerHTML = '<b>Configuration Error:</b><ul style="margin:6px 0 0 18px;">' + errors.map(e => `<li>${e}</li>`).join('') + '</ul>'
    return // Do not regenerate layout
  } else {
    errorPanel.style.display = 'none'
    errorPanel.innerHTML = ''
  }

  config.width = width

  config.length = length
  config.height = height
  config.seatTypes[0].width = seatSize
  config.seatTypes[0].depth = seatSize
  config.seatSpacing = seatSpacing
  config.shape = shape
  config.aisles.horizontal = aisleH
  config.aisles.vertical = aisleV
  config.aisles.width = aisleWidth
  config.bleachers = config.bleachers || {}
  config.bleachers.enabled = bleachersEnabled
  config.bleachers.numberOfSteps = Number.isNaN(bleachersSteps) ? config.bleachers.numberOfSteps : bleachersSteps
  config.bleachers.width = Number.isNaN(bleachersWidth) ? config.bleachers.width : bleachersWidth
  config.bleachers.stepDepth =
    config.bleachers.numberOfSteps > 0 ? config.bleachers.width / config.bleachers.numberOfSteps : config.bleachers.width
  config.bleachers.aisleCount = Number.isNaN(bleachersAisles) ? 0 : bleachersAisles
  config.bleachers.entranceWidth = Number.isNaN(bleachersEntranceWidth) ? 2.5 : bleachersEntranceWidth


  loadLayout(config)
}

/**
 * Update statistics display
 */
function updateStats(layout: any): void {
  const statsContainer = document.getElementById('stats-container')
  if (!statsContainer) return

  // Statistics
  const statsHtml = `
    <div class="stat-item"><span class="stat-label">Total Seats:</span><span class="stat-value">${layout.totalSeats}</span></div>
    <div class="stat-item"><span class="stat-label">Utilization:</span><span class="stat-value">${(layout.utilizationRatio * 100).toFixed(1)}%</span></div>
  `
  statsContainer.innerHTML = statsHtml

  // Measurements
  const measurementsContainer = document.getElementById('measurements-container')
  if (!measurementsContainer) return
  let mHtml = ''
  mHtml += `<div class="stat-item"><span class="stat-label">Gym Size:</span><span class="stat-value">${layout.config?.width?.toFixed(2) || '?'}m × ${layout.config?.length?.toFixed(2) || '?'}m</span></div>`
  // Stage
  const stage = layout.zones?.find((z: any) => z.type === 'stage')
  if (stage) {
    mHtml += `<div class="stat-item"><span class="stat-label">Stage:</span><span class="stat-value">${(stage.bounds.maxX - stage.bounds.minX).toFixed(2)}m × ${(stage.bounds.maxY - stage.bounds.minY).toFixed(2)}m</span></div>`
  }
  // Bleachers
  const bleacherSeats = layout.seats?.filter((s: any) => s.metadata.bleacher)
  if (bleacherSeats && bleacherSeats.length > 0) {
    const minX = Math.min(...bleacherSeats.map((s: any) => s.position.x - s.dimension.width / 2))
    const maxX = Math.max(...bleacherSeats.map((s: any) => s.position.x + s.dimension.width / 2))
    const minY = Math.min(...bleacherSeats.map((s: any) => s.position.y - s.dimension.depth / 2))
    const maxY = Math.max(...bleacherSeats.map((s: any) => s.position.y + s.dimension.depth / 2))
    mHtml += `<div class="stat-item"><span class="stat-label">Bleacher:</span><span class="stat-value">${(maxX - minX).toFixed(2)}m × ${(maxY - minY).toFixed(2)}m</span></div>`
  }
  // Aisles - show configured aisle width (consistent regardless of stage splits)
  if (layout.config?.aisles?.width && layout.config.aisles.width > 0) {
    const totalAisles = (layout.config.aisles.horizontal || 0) + (layout.config.aisles.vertical || 0)
    if (totalAisles > 0) {
      mHtml += `<div class="stat-item"><span class="stat-label">Aisle:</span><span class="stat-value">${layout.config.aisles.width.toFixed(2)}m (${totalAisles} configured)</span></div>`
    }
  }
  measurementsContainer.innerHTML = mHtml || '<p>No measurements available</p>'
}

/**
 * Download JSON file
 */
function downloadJSON(jsonString: string, filename: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([jsonString], { type: 'application/json' }))
  link.download = filename
  link.click()
}

/**
 * Import JSON file and load layout
 */
function importJSONFile(file: File): void {
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const jsonContent = e.target?.result as string
      const layout = JSON.parse(jsonContent) as LayoutOutput
      
      // Validate that it has the required layout structure
      if (!layout.config || !Array.isArray(layout.seats) || !Array.isArray(layout.zones)) {
        throw new Error('Invalid layout file: missing required properties')
      }

      // Load the imported layout into renderer and update UI
      if (state.renderer && layout) {
        state.latestLayout = layout
        state.renderer.loadLayout(layout)
        state.renderer.setLayoutAlert(
          layout.warning
            ? buildLayoutAlert(
                layout.warning,
                layout.config,
                layout,
                layout.config?.targetPeople ?? null
              )
            : null
        )
        
        // Update config inputs from the imported layout
        setInputsFromConfig(layout.config)
        
        // Update statistics
        updateStats(layout)
        
        // Show success message
        const errorPanel = document.getElementById('error-panel') as HTMLElement
        if (errorPanel) {
          errorPanel.style.display = 'block'
          errorPanel.innerHTML = `<b style="color: #059669;">✓ Layout imported successfully!</b>`
          setTimeout(() => {
            errorPanel.style.display = 'none'
          }, 3000)
        }
      }
    } catch (error: any) {
      const errorPanel = document.getElementById('error-panel') as HTMLElement
      if (errorPanel) {
        errorPanel.style.display = 'block'
        errorPanel.innerHTML = `<b>Import Error:</b> ${error?.message || 'Failed to import layout'}`
      }
    }
  }
  reader.readAsText(file)
}

/**
 * Get CSS styles
 */
function getStyles(): string {
  return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f3f4f6;
      color: #1f2937;
    }

    .app-wrapper {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .app-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .app-header h1 {
      font-size: 24px;
      margin-bottom: 4px;
    }

    .app-header p {
      font-size: 13px;
      opacity: 0.9;
    }

    .app-main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .app-sidebar {
      width: 300px;
      background: white;
      border-right: 1px solid #e5e7eb;
      overflow-y: auto;
      padding: 20px;
    }

    .control-panel h2 {
      font-size: 18px;
      margin-bottom: 16px;
      color: #374151;
    }

    .control-panel h3 {
      font-size: 14px;
      margin-top: 16px;
      margin-bottom: 10px;
      color: #6b7280;
      font-weight: 600;
    }

    .control-group {
      margin-bottom: 16px;
    }

    .control-group label {
      display: block;
      font-size: 13px;
      margin-bottom: 8px;
      color: #374151;
    }

    .control-group input[type="checkbox"] {
      margin-right: 6px;
      cursor: pointer;
    }

    .control-group select {
      width: 100%;
      padding: 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
    }

    .button-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }

    button {
      padding: 10px 12px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      background: #667eea;
      color: white;
      transition: all 0.2s;
    }

    button:hover {
      background: #5a67d8;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }

    button:active {
      transform: scale(0.98);
    }

    .zoom-controls {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
    }

    .zoom-controls button {
      flex: 1;
      padding: 8px;
    }

    .help-text {
      font-size: 12px;
      color: #6b7280;
      font-style: italic;
    }

    .stats-panel {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      margin-top: 16px;
    }

    .stat-item {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 13px;
    }

    .stat-label {
      color: #6b7280;
    }

    .stat-value {
      font-weight: 600;
      color: #667eea;
    }

    .app-content {
      flex: 1;
      overflow: hidden;
    }

    .canvas-container {
      width: 100%;
      height: 100%;
      background: white;
    }

    #seating-canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .app-footer {
      background: #f3f4f6;
      border-top: 1px solid #e5e7eb;
      padding: 12px 20px;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }

    /* Scrollbar styling */
    .app-sidebar::-webkit-scrollbar {
      width: 8px;
    }

    .app-sidebar::-webkit-scrollbar-track {
      background: #f1f5f9;
    }

    .app-sidebar::-webkit-scrollbar-thumb {
      background: #cbd5e0;
      border-radius: 4px;
    }

    .app-sidebar::-webkit-scrollbar-thumb:hover {
      background: #a0aec0;
    }

    @media (max-width: 768px) {
      .app-main {
        flex-direction: column;
      }

      .app-sidebar {
        width: 100%;
        border-right: none;
        border-bottom: 1px solid #e5e7eb;
        max-height: 40%;
      }
    }
  `
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp)
} else {
  initializeApp()
}
