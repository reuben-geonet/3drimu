export const DEMO_ANIMATION = {
  travelMs: 2600,
  orbitMs: 5200,
  nextGapMs: 350,
  orbitRadius: 7.2,
  orbitHeight: 5.4,
  motionStartAngleOffsetRadians: 0.26,
  motionSweepRadians: -0.24,
  cardDrawMs: 850,
  cardCheckingMs: 700,
  cardRowRevealMs: 420,
  cardRowStaggerMs: 145,
  cardFadeMs: 900,
  cardOutOfViewGraceMs: 700,
  maxRetainedCards: 4
} as const;

const DEMO_CARD_PANEL_SCALE = 0.5;
const DEMO_CARD_CANVAS_WIDTH = 1024;
const DEMO_CARD_CANVAS_HEIGHT = 640;
const DEMO_CARD_BASE_WORLD_WIDTH = 5.4;

export const DEMO_CARD = {
  // Change this one value to resize the 3D panel and its site-relative placement.
  panelScale: DEMO_CARD_PANEL_SCALE,
  canvasWidth: DEMO_CARD_CANVAS_WIDTH,
  canvasHeight: DEMO_CARD_CANVAS_HEIGHT,
  worldWidth: DEMO_CARD_BASE_WORLD_WIDTH * DEMO_CARD_PANEL_SCALE,
  worldHeight:
    DEMO_CARD_BASE_WORLD_WIDTH *
    (DEMO_CARD_CANVAS_HEIGHT / DEMO_CARD_CANVAS_WIDTH) *
    DEMO_CARD_PANEL_SCALE,
  verticalOffset: 2.6 * DEMO_CARD_PANEL_SCALE,
  sideOffset: 0.45 * DEMO_CARD_PANEL_SCALE,
  forwardOffset: 0.05 * DEMO_CARD_PANEL_SCALE
} as const;
