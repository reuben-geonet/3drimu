import * as THREE from "three";
import { feature } from "topojson-client";
import countries50m from "world-atlas/countries-50m.json";
import type {
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
  Position
} from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { MapCameraRig } from "./cameraRig";
import { buildDemoRoute, formatMetricLabel } from "./demo";
import { DEMO_ACTIVE_MARKER, DEMO_ANIMATION, DEMO_CARD } from "./demoConfig";
import {
  getMarkerZoomStyle,
  pickNearestProjectedMarker,
  type MarkerZoomStyle,
  type ProjectedMarkerCandidate
} from "./markerInteraction";
import { RIMU_STATUSES, STATUS_COLORS, STATUS_LABELS } from "./status";
import type { LinkArc, RimuStatus, SiteMarker } from "./types";

interface MarkerVisual {
  site: SiteMarker;
  group: THREE.Group;
  statusColor: THREE.Color;
  base: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  activeHalo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  activeGlow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  activeOrbitRings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[];
  phase: number;
  speed: number;
  alertStrength: number;
}

interface LinkVisual {
  group: THREE.Group;
  curve: THREE.QuadraticBezierCurve3;
  packets: LinkPacketVisual[];
  speed: number;
}

interface LinkPacketVisual {
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  progress: number;
  delay: number;
}

export interface DemoModeState {
  active: boolean;
  routeSize: number;
  currentSiteId: string | null;
  currentSiteName: string | null;
}

interface DemoCardRow {
  label: string;
  value: string;
  status?: RimuStatus;
  checkable: boolean;
}

interface DemoCardVisual {
  site: SiteMarker;
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  material: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  rows: DemoCardRow[];
  createdAt: number;
  fadeStartedAt: number | null;
}

interface MapSceneOptions {
  onMarkerHover?: (
    site: SiteMarker | null,
    point?: { x: number; y: number }
  ) => void;
  onMarkerClick?: (site: SiteMarker) => void;
  onDemoStateChange?: (state: DemoModeState) => void;
}

interface CountryProperties {
  name?: string;
}

const NZ_TARGET = { lat: -41.35, lng: 174.9 };
const MAP_SCALE = 1.65;
const LON_SCALE = MAP_SCALE * Math.cos((NZ_TARGET.lat * Math.PI) / 180);
const COUNTRY_DEPTH = 1.25;
const MAP_MARGIN = 32;
const WORLD_WIDTH = 360 * LON_SCALE;
const WORLD_HEIGHT = 180 * MAP_SCALE;
const WORLD_CENTER_Z = NZ_TARGET.lat * MAP_SCALE;
const OCEAN_OVERSCAN = 360;
// Status markers are composed from several meshes; scale the group so the glyph stays proportional.
const STATUS_MARKER_SCALE = 0.25;
const LINK_PACKET_RADIUS = 0.07;
const LINK_PACKET_COUNT = 9;
const MARKER_CLICK_DRAG_TOLERANCE_PX = 6;
const MARKER_PICK_RADIUS_PX = 18;

const LINK_RAINBOW_COLORS = [
  "#ff5f7e",
  "#ffd166",
  "#7cf29c",
  "#31d7ff",
  "#8a7dff",
  "#ff7df0",
  "#ff5f7e"
] as const;

export class MapScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cameraRig: MapCameraRig;
  private readonly mapGroup = new THREE.Group();
  private readonly countryGroup = new THREE.Group();
  private readonly borderGroup = new THREE.Group();
  private readonly gridGroup = new THREE.Group();
  private readonly linkGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();
  private readonly demoCardGroup = new THREE.Group();
  private readonly markers: MarkerVisual[] = [];
  private readonly links: LinkVisual[] = [];
  private readonly demoCards: DemoCardVisual[] = [];
  private readonly markerPickCandidates: ProjectedMarkerCandidate<SiteMarker>[] = [];
  private readonly markerProjection = new THREE.Vector3();
  private readonly activeMarkerFlashColor = new THREE.Color(
    DEMO_ACTIVE_MARKER.flashColor
  );
  private readonly activeMarkerHaloColor = new THREE.Color(
    DEMO_ACTIVE_MARKER.haloColor
  );
  private readonly visibleStatuses = new Set<RimuStatus>(RIMU_STATUSES);
  private visibleTag: string | null = null;
  private readonly startedAt = performance.now();
  private readonly onMarkerHover?: MapSceneOptions["onMarkerHover"];
  private readonly onMarkerClick?: MapSceneOptions["onMarkerClick"];
  private readonly onDemoStateChange?: MapSceneOptions["onDemoStateChange"];
  private readonly landMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.74,
    metalness: 0.05
  });
  private readonly nzMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.58,
    metalness: 0.08
  });
  private readonly oceanMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.82,
    metalness: 0.02,
    transparent: true
  });
  private readonly borderMaterial = new THREE.LineBasicMaterial({
    transparent: true,
    depthWrite: false
  });
  private readonly nzBorderMaterial = new THREE.LineBasicMaterial({
    transparent: true,
    depthWrite: false
  });
  private readonly gridMaterial = new THREE.LineBasicMaterial({
    transparent: true,
    depthWrite: false
  });
  private sites: SiteMarker[] = [];
  private linksVisible = true;
  private previousLinkElapsed = 0;
  private animationFrame = 0;
  private theme: "dark" | "light" = "dark";
  private disposed = false;
  private pointerDownPoint: { x: number; y: number } | null = null;
  private pointerMovedAfterDown = false;
  private demoActive = false;
  private demoGeneration = 0;
  private demoRoute: SiteMarker[] = [];
  private demoRouteIndex = 0;
  private demoLastSiteId: string | null = null;
  private demoCurrentSite: SiteMarker | null = null;
  private demoFocusedSiteId: string | null = null;
  private demoMarkerFocusStartedAt = 0;
  private demoMarkerFocusReleasedAt: number | null = null;
  private activeDemoCard: DemoCardVisual | null = null;

  constructor(container: HTMLElement, options: MapSceneOptions = {}) {
    this.container = container;
    this.onMarkerHover = options.onMarkerHover;
    this.onMarkerClick = options.onMarkerClick;
    this.onDemoStateChange = options.onDemoStateChange;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.cameraRig = new MapCameraRig({
      aspect: this.container.clientWidth / this.container.clientHeight,
      domElement: this.renderer.domElement,
      target: this.getNzTarget()
    });
    this.camera = this.cameraRig.camera;

    this.mapGroup.add(this.createOceanSurface());
    this.mapGroup.add(this.gridGroup, this.countryGroup, this.borderGroup);
    this.scene.add(this.mapGroup);
    this.scene.add(this.linkGroup, this.markerGroup, this.demoCardGroup);
    this.scene.add(this.createStars());
    this.createGrid();
    this.createCountries();
    this.addLights();

    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("click", this.onClick);
    this.renderer.domElement.addEventListener("pointerleave", this.clearHover);
    window.addEventListener("resize", this.onResize);
    this.refreshMapColors();
    this.animate();
  }

  setTheme(theme: "dark" | "light"): void {
    this.theme = theme;
    this.scene.background = new THREE.Color(theme === "dark" ? "#020407" : "#e7eef5");
    this.refreshMapColors();
  }

  setData(sites: SiteMarker[], links: LinkArc[]): void {
    this.sites = sites;
    this.clearLinks();
    this.addLinks(links);
    this.renderVisibleMarkers();

    if (this.demoActive) {
      this.restartDemoLoop();
    }
  }

  setLinksVisible(visible: boolean): void {
    if (this.linksVisible === visible) {
      return;
    }

    this.linksVisible = visible;

    if (visible) {
      this.restartLinkPackets();
    }
  }

  getLinksVisible(): boolean {
    return this.linksVisible;
  }

  getLinkCount(): number {
    return this.links.length;
  }

  setVisibleStatuses(statuses: ReadonlySet<RimuStatus>): void {
    this.visibleStatuses.clear();

    for (const status of statuses) {
      this.visibleStatuses.add(status);
    }

    this.clearHover();
    this.renderVisibleMarkers();

    if (this.demoActive) {
      this.restartDemoLoop();
    }
  }

  setVisibleTag(tag: string | null): void {
    if (this.visibleTag === tag) {
      return;
    }

    this.visibleTag = tag;
    this.clearHover();
    this.renderVisibleMarkers();

    if (this.demoActive) {
      this.restartDemoLoop();
    }
  }

  getVisibleSiteCount(): number {
    return this.getVisibleSites().length;
  }

  setDemoMode(active: boolean): void {
    if (active === this.demoActive) {
      return;
    }

    if (active) {
      this.startDemoMode();
      return;
    }

    this.stopDemoMode(true);
  }

  getDemoModeState(): DemoModeState {
    return {
      active: this.demoActive,
      routeSize: this.demoRoute.length,
      currentSiteId: this.demoCurrentSite?.id ?? null,
      currentSiteName: this.demoCurrentSite?.locality ?? null
    };
  }

  startIntro(): Promise<void> {
    return this.cameraRig.startIntro(this.getNzTarget());
  }

  resetView(): void {
    this.stopDemoMode(false);
    this.cameraRig.resetView(this.getNzTarget());
  }

  dispose(): void {
    this.disposed = true;
    this.stopDemoMode(false);
    this.clearDemoCards();
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.onResize);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.renderer.domElement.removeEventListener("pointerleave", this.clearHover);
    this.cameraRig.dispose();
    this.renderer.dispose();
  }

  private startDemoMode(): void {
    this.demoActive = true;
    this.demoGeneration++;
    this.demoCurrentSite = null;
    this.clearDemoMarkerFocus();
    this.activeDemoCard = null;
    this.clearHover();
    this.rebuildDemoRoute();

    if (this.demoRoute.length === 0) {
      this.stopDemoMode(true);
      return;
    }

    this.notifyDemoState();
    void this.runDemoLoop(this.demoGeneration);
  }

  private stopDemoMode(resetCamera: boolean): void {
    const wasActive = this.demoActive;

    this.demoActive = false;
    this.demoGeneration++;
    this.demoRoute = [];
    this.demoRouteIndex = 0;
    this.demoCurrentSite = null;
    this.clearDemoMarkerFocus();
    this.activeDemoCard = null;
    this.cameraRig.cancelDemoMotion();
    this.fadeDemoCards(performance.now());

    if (resetCamera) {
      this.cameraRig.resetView(this.getNzTarget());
    }

    if (wasActive) {
      this.notifyDemoState();
    }
  }

  private restartDemoLoop(): void {
    if (!this.demoActive) {
      return;
    }

    this.demoGeneration++;
    this.demoCurrentSite = null;
    this.clearDemoMarkerFocus();
    this.activeDemoCard = null;
    this.cameraRig.cancelDemoMotion();
    this.fadeDemoCards(performance.now());
    this.rebuildDemoRoute();

    if (this.demoRoute.length === 0) {
      this.stopDemoMode(true);
      return;
    }

    this.notifyDemoState();
    void this.runDemoLoop(this.demoGeneration);
  }

  private async runDemoLoop(generation: number): Promise<void> {
    while (this.isCurrentDemoGeneration(generation)) {
      const site = this.getNextDemoSite();

      if (!site) {
        this.stopDemoMode(true);
        return;
      }

      this.demoCurrentSite = site;
      this.demoLastSiteId = site.id;
      this.notifyDemoState();

      const target = this.getDemoSiteTarget(site);
      const frontAngle = this.getDemoStartAngle(target);
      const startAngle =
        frontAngle + DEMO_ANIMATION.motionStartAngleOffsetRadians;
      const arrived = await this.cameraRig.flyToDemoTarget(target, {
        durationMs: DEMO_ANIMATION.travelMs,
        radius: DEMO_ANIMATION.orbitRadius,
        height: DEMO_ANIMATION.orbitHeight,
        angle: startAngle
      });

      if (!arrived || !this.isCurrentDemoGeneration(generation)) {
        return;
      }

      this.setDemoMarkerFocus(site);
      this.activeDemoCard = this.createDemoCard(site, target);
      await this.waitForDemoCardIntro(this.activeDemoCard, generation);

      if (!this.isCurrentDemoGeneration(generation)) {
        return;
      }

      const orbitStartedAt = performance.now();

      while (
        this.isCurrentDemoGeneration(generation) &&
        performance.now() - orbitStartedAt < DEMO_ANIMATION.orbitMs
      ) {
        const orbitProgress = clamp01(
          (performance.now() - orbitStartedAt) / DEMO_ANIMATION.orbitMs
        );

        this.cameraRig.setDemoOrbitFrame(target, {
          radius: DEMO_ANIMATION.orbitRadius,
          height: DEMO_ANIMATION.orbitHeight,
          angle:
            startAngle +
            DEMO_ANIMATION.motionSweepRadians * easeInOutSine(orbitProgress)
        });
        await nextAnimationFrame();
      }

      await this.animateActiveDemoCardOut(generation);

      if (!this.isCurrentDemoGeneration(generation)) {
        return;
      }

      await delay(DEMO_ANIMATION.nextGapMs);
    }
  }

  private rebuildDemoRoute(): void {
    this.demoRoute = buildDemoRoute(this.getVisibleSites(), this.demoLastSiteId);
    this.demoRouteIndex = 0;
  }

  private getNextDemoSite(): SiteMarker | null {
    if (this.demoRoute.length === 0) {
      return null;
    }

    if (this.demoRouteIndex >= this.demoRoute.length) {
      this.rebuildDemoRoute();
    }

    const site = this.demoRoute[this.demoRouteIndex] ?? null;
    this.demoRouteIndex++;

    return site;
  }

  private getDemoSiteTarget(site: SiteMarker): THREE.Vector3 {
    return this.projectLatLng(site.lat, site.lng, COUNTRY_DEPTH + 1.44);
  }

  private setDemoMarkerFocus(site: SiteMarker): void {
    this.demoFocusedSiteId = site.id;
    this.demoMarkerFocusStartedAt = performance.now();
    this.demoMarkerFocusReleasedAt = null;
  }

  private releaseDemoMarkerFocus(): void {
    if (this.demoFocusedSiteId === null || this.demoMarkerFocusReleasedAt !== null) {
      return;
    }

    this.demoMarkerFocusReleasedAt = performance.now();
  }

  private clearDemoMarkerFocus(): void {
    this.demoFocusedSiteId = null;
    this.demoMarkerFocusStartedAt = 0;
    this.demoMarkerFocusReleasedAt = null;
  }

  private getDemoStartAngle(target: THREE.Vector3): number {
    const offset = this.camera.position.clone().sub(target);

    if (offset.lengthSq() < 0.001) {
      return 0;
    }

    return Math.atan2(offset.z, offset.x);
  }

  private isCurrentDemoGeneration(generation: number): boolean {
    return this.demoActive && this.demoGeneration === generation;
  }

  private notifyDemoState(): void {
    this.onDemoStateChange?.(this.getDemoModeState());
  }

  private createOceanSurface(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
    const geometry = new THREE.PlaneGeometry(
      WORLD_WIDTH + MAP_MARGIN * 2 + OCEAN_OVERSCAN,
      WORLD_HEIGHT + MAP_MARGIN * 2 + OCEAN_OVERSCAN
    );
    geometry.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geometry, this.oceanMaterial);
    mesh.position.z = WORLD_CENTER_Z;
    mesh.receiveShadow = true;

    return mesh;
  }

  private createGrid(): void {
    const lineMaterial = this.gridMaterial;

    for (let lat = -60; lat <= 60; lat += 30) {
      const points: THREE.Vector3[] = [];

      for (let deltaLng = -180; deltaLng <= 180; deltaLng += 6) {
        points.push(this.projectDelta(deltaLng, lat, 0.05));
      }

      this.gridGroup.add(this.createLine(points, lineMaterial));
    }

    for (let deltaLng = -180; deltaLng <= 180; deltaLng += 30) {
      const points: THREE.Vector3[] = [];

      for (let lat = -75; lat <= 75; lat += 4) {
        points.push(this.projectDelta(deltaLng, lat, 0.05));
      }

      this.gridGroup.add(this.createLine(points, lineMaterial));
    }
  }

  private createCountries(): void {
    const countries = getCountries();

    for (const country of countries.features) {
      const geometry = country.geometry;

      if (!isPolygonGeometry(geometry)) {
        continue;
      }

      const name = country.properties?.name ?? "";
      const isNewZealand = name === "New Zealand";
      const material = isNewZealand ? this.nzMaterial : this.landMaterial;
      const borderMaterial = isNewZealand
        ? this.nzBorderMaterial
        : this.borderMaterial;

      for (const polygon of getPolygons(geometry)) {
        const shape = createShape(polygon);

        if (!shape) {
          continue;
        }

        const countryGeometry = new THREE.ExtrudeGeometry(shape, {
          depth: COUNTRY_DEPTH,
          bevelEnabled: false,
          curveSegments: 1,
          steps: 1
        });
        countryGeometry.rotateX(-Math.PI / 2);
        countryGeometry.computeVertexNormals();

        const mesh = new THREE.Mesh(countryGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.countryGroup.add(mesh);

        for (const ring of polygon) {
          const points = projectRingToWorld(ring, COUNTRY_DEPTH + 0.08);

          if (points.length > 2) {
            this.borderGroup.add(this.createLine(points, borderMaterial));
          }
        }
      }
    }
  }

  private addLinks(links: LinkArc[]): void {
    for (const link of links) {
      const start = this.projectLatLng(link.startLat, link.startLng, COUNTRY_DEPTH + 0.34);
      const end = this.projectLatLng(link.endLat, link.endLng, COUNTRY_DEPTH + 0.34);
      const distance = start.distanceTo(end);
      const midpoint = start.clone().lerp(end, 0.5);
      midpoint.y += getLinkArcLift(distance);

      const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end);
      const group = new THREE.Group();
      const packets: LinkPacketVisual[] = [];

      for (let index = 0; index < LINK_PACKET_COUNT; index++) {
        const packetGeometry = new THREE.IcosahedronGeometry(LINK_PACKET_RADIUS, 1);
        const packetMaterial = new THREE.MeshBasicMaterial({
          color: LINK_RAINBOW_COLORS[(index * 2) % LINK_RAINBOW_COLORS.length],
          transparent: true,
          opacity: 0.95,
          depthWrite: false
        });
        const packet = new THREE.Mesh(packetGeometry, packetMaterial);
        const delay = index / LINK_PACKET_COUNT;

        packet.visible = false;
        packets.push({
          mesh: packet,
          progress: this.linksVisible ? -delay : 1,
          delay
        });
        group.add(packet);
      }

      group.visible = this.linksVisible;
      this.linkGroup.add(group);
      this.links.push({
        group,
        curve,
        packets,
        speed: getLinkPacketSpeed(link)
      });
    }
  }

  private addMarkers(sites: SiteMarker[]): void {
    const sphereGeometry = new THREE.SphereGeometry(0.56, 16, 12);
    const beamGeometry = new THREE.CylinderGeometry(0.08, 0.24, 4.4, 10, 1, true);
    const ringGeometry = new THREE.TorusGeometry(0.92, 0.035, 8, 36);
    const activeHaloGeometry = new THREE.TorusGeometry(1.48, 0.05, 8, 48);
    const activeGlowGeometry = new THREE.SphereGeometry(0.78, 20, 14);
    const activeOrbitRingGeometry = new THREE.TorusGeometry(0.92, 0.035, 8, 36);

    for (const site of sites) {
      const color = new THREE.Color(STATUS_COLORS[site.status]);
      const group = new THREE.Group();
      const surface = this.projectLatLng(site.lat, site.lng, COUNTRY_DEPTH + 0.32);
      const alertStrength = getAlertStrength(site.status);

      group.position.copy(surface);
      group.scale.setScalar(STATUS_MARKER_SCALE);

      const base = new THREE.Mesh(
        sphereGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.96
        })
      );
      base.position.y = 0.18;
      base.scale.setScalar(1 + alertStrength * 0.25);

      const beam = new THREE.Mesh(
        beamGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.16 + alertStrength * 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      beam.position.y = 2.25;

      const ring = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35 + alertStrength * 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.22;

      const activeGlow = new THREE.Mesh(
        activeGlowGeometry,
        new THREE.MeshBasicMaterial({
          color: this.activeMarkerFlashColor,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      activeGlow.position.y = 0.18;
      activeGlow.visible = false;
      activeGlow.renderOrder = 8;

      const activeHalo = new THREE.Mesh(
        activeHaloGeometry,
        new THREE.MeshBasicMaterial({
          color: this.activeMarkerHaloColor,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      activeHalo.rotation.x = Math.PI / 2;
      activeHalo.position.y = 0.24;
      activeHalo.visible = false;
      activeHalo.renderOrder = 9;

      const activeOrbitRings = Array.from(
        { length: DEMO_ACTIVE_MARKER.orbitRingCount },
        (_, index) => {
          const orbitRing = new THREE.Mesh(
            activeOrbitRingGeometry,
            new THREE.MeshBasicMaterial({
              color: this.activeMarkerHaloColor,
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false
            })
          );

          orbitRing.rotation.x = Math.PI / 2;
          orbitRing.position.y = 0.22;
          orbitRing.visible = false;
          orbitRing.renderOrder = 10 + index;

          return orbitRing;
        }
      );

      group.add(activeGlow, base, beam, ring, activeHalo, ...activeOrbitRings);
      this.markerGroup.add(group);
      this.markers.push({
        site,
        group,
        statusColor: color,
        base,
        beam,
        ring,
        activeHalo,
        activeGlow,
        activeOrbitRings,
        phase: Math.random() * Math.PI * 2,
        speed: 1.2 + Math.random() * 0.8 + alertStrength * 0.6,
        alertStrength
      });
    }
  }

  private renderVisibleMarkers(): void {
    this.clearMarkers();
    this.addMarkers(this.getVisibleSites());
  }

  private getVisibleSites(): SiteMarker[] {
    return this.sites.filter(
      (site) =>
        this.visibleStatuses.has(site.status) &&
        (this.visibleTag === null || site.tags.includes(this.visibleTag))
    );
  }

  private clearMarkers(): void {
    for (const marker of this.markers) {
      marker.group.traverse((object) => this.disposeObjectResources(object));
    }

    this.markerGroup.clear();
    this.markers.length = 0;
  }

  private clearLinks(): void {
    for (const link of this.links) {
      link.group.traverse((object) => this.disposeObjectResources(object));
    }

    this.linkGroup.clear();
    this.links.length = 0;
  }

  private restartLinkPackets(): void {
    for (const link of this.links) {
      link.group.visible = true;

      for (const packet of link.packets) {
        packet.progress = -packet.delay;
        packet.mesh.visible = false;
      }
    }
  }

  private createDemoCard(
    site: SiteMarker,
    target: THREE.Vector3
  ): DemoCardVisual | null {
    const canvas = document.createElement("canvas");
    canvas.width = DEMO_CARD.canvasWidth;
    canvas.height = DEMO_CARD.canvasHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(DEMO_CARD.worldWidth, DEMO_CARD.worldHeight),
      material
    );
    const group = new THREE.Group();

    mesh.renderOrder = 12;
    group.add(mesh);
    group.position.copy(this.getDemoCardPosition(target));
    group.lookAt(this.camera.position);
    group.scale.setScalar(0.72);
    this.demoCardGroup.add(group);

    const card: DemoCardVisual = {
      site,
      group,
      mesh,
      material,
      texture,
      canvas,
      context,
      rows: this.getDemoCardRows(site),
      createdAt: performance.now(),
      fadeStartedAt: null
    };

    this.demoCards.push(card);
    this.drawDemoCard(card, performance.now());
    this.enforceDemoCardLimit(performance.now());

    return card;
  }

  private getDemoCardPosition(target: THREE.Vector3): THREE.Vector3 {
    const forward = this.camera.position.clone().sub(target);
    forward.y = 0;

    if (forward.lengthSq() < 0.001) {
      forward.set(0, 0, 1);
    }

    forward.normalize();

    const side = new THREE.Vector3(-forward.z, 0, forward.x).normalize();

    return target
      .clone()
      .addScaledVector(side, DEMO_CARD.sideOffset)
      .addScaledVector(forward, DEMO_CARD.forwardOffset)
      .add(new THREE.Vector3(0, DEMO_CARD.verticalOffset, 0));
  }

  private getDemoCardRows(site: SiteMarker): DemoCardRow[] {
    const rows: DemoCardRow[] = [
      {
        label: "Status",
        value: STATUS_LABELS[site.status],
        status: site.status,
        checkable: true
      }
    ];

    if (site.sitecode) {
      rows.push({
        label: "Site",
        value: site.sitecode,
        checkable: false
      });
    }

    rows.push({
      label: "Devices",
      value: String(site.devices.length),
      checkable: false
    });

    const fieldRows = Object.entries(site.fieldStatus).slice(0, 5);

    if (fieldRows.length === 0) {
      rows.push({
        label: "Fields",
        value: "No current fault fields",
        status: "ok",
        checkable: false
      });
    } else {
      for (const [field, status] of fieldRows) {
        rows.push({
          label: formatMetricLabel(field),
          value: STATUS_LABELS[status],
          status,
          checkable: true
        });
      }
    }

    if (site.tags.length > 0 && rows.length < 8) {
      rows.push({
        label: "Tags",
        value: site.tags.slice(0, 4).join(", "),
        checkable: false
      });
    }

    return rows.slice(0, 8);
  }

  private updateDemoCards(now: number): void {
    for (const card of [...this.demoCards]) {
      if (card === this.activeDemoCard && card.fadeStartedAt === null) {
        card.group.lookAt(this.camera.position);
      }

      this.drawDemoCard(card, now);

      if (
        card !== this.activeDemoCard &&
        card.fadeStartedAt === null &&
        now - card.createdAt > DEMO_ANIMATION.cardOutOfViewGraceMs &&
        !this.isDemoCardInView(card)
      ) {
        card.fadeStartedAt = now;
      }

      if (
        card.fadeStartedAt !== null &&
        now - card.fadeStartedAt >= DEMO_ANIMATION.cardFadeMs
      ) {
        this.disposeDemoCard(card);
      }
    }

    this.enforceDemoCardLimit(now);
  }

  private async animateActiveDemoCardOut(generation: number): Promise<void> {
    const card = this.activeDemoCard;
    this.activeDemoCard = null;
    this.releaseDemoMarkerFocus();

    if (!card) {
      return;
    }

    const fadeStartedAt = card.fadeStartedAt ?? performance.now();
    card.fadeStartedAt = fadeStartedAt;

    await delay(
      Math.max(0, DEMO_ANIMATION.cardFadeMs - (performance.now() - fadeStartedAt))
    );

    if (!this.isCurrentDemoGeneration(generation)) {
      return;
    }

    if (this.demoCards.includes(card)) {
      this.disposeDemoCard(card);
    }
  }

  private async waitForDemoCardIntro(
    card: DemoCardVisual | null,
    generation: number
  ): Promise<void> {
    if (!card) {
      return;
    }

    const finalRowDelay = Math.max(0, card.rows.length - 1) *
      DEMO_ANIMATION.cardRowStaggerMs;
    const introDuration =
      DEMO_ANIMATION.cardDrawMs +
      finalRowDelay +
      Math.max(DEMO_ANIMATION.cardCheckingMs, DEMO_ANIMATION.cardRowRevealMs);
    const remaining = introDuration - (performance.now() - card.createdAt);

    if (remaining > 0) {
      await delay(remaining);
    }

    if (!this.isCurrentDemoGeneration(generation)) {
      return;
    }
  }

  private drawDemoCard(card: DemoCardVisual, now: number): void {
    const { canvas, context } = card;
    const width = canvas.width;
    const height = canvas.height;
    const age = now - card.createdAt;
    const drawProgress = clamp01(age / DEMO_ANIMATION.cardDrawMs);
    const drawEase = easeOutCubic(drawProgress);
    const fadeProgress = card.fadeStartedAt !== null
      ? clamp01((now - card.fadeStartedAt) / DEMO_ANIMATION.cardFadeMs)
      : 0;
    const fadeOpacity = 1 - fadeProgress;
    const flash =
      card.site.status === "ok" ? 0 : (Math.sin(now / 130) + 1) / 2;
    const opacity =
      fadeOpacity * (0.18 + drawEase * 0.82) * (0.86 + flash * 0.14);
    const scale =
      fadeOpacity *
      (0.72 + easeOutBack(drawProgress) * 0.28) *
      this.getDemoCardViewportScale();
    const accent = STATUS_COLORS[card.site.status];

    card.material.opacity = opacity;
    card.group.scale.setScalar(scale);

    context.clearRect(0, 0, width, height);
    context.save();
    context.beginPath();
    context.rect(0, 0, width * drawEase, height);
    context.clip();

    fillRoundRect(
      context,
      28,
      28,
      width - 56,
      height - 56,
      34,
      "rgba(4, 10, 14, 0.88)"
    );
    fillRoundRect(
      context,
      46,
      46,
      width - 92,
      96,
      26,
      hexToRgba(accent, card.site.status === "ok" ? 0.28 : 0.4 + flash * 0.18)
    );
    strokeRoundRect(
      context,
      28,
      28,
      width - 56,
      height - 56,
      34,
      hexToRgba(accent, 0.72 + flash * 0.28),
      6
    );

    const headerContentX = 70;
    const headerContentRight = width - 70;
    const headerGap = 28;
    const statusLabel = STATUS_LABELS[card.site.status];
    const statusPillWidth = measureStatusPillWidth(context, statusLabel);
    const statusPillX = headerContentRight - statusPillWidth;
    const titleMaxWidth = Math.max(
      0,
      statusPillX - headerGap - headerContentX
    );

    context.textBaseline = "middle";
    context.fillStyle = "#f5f7fb";
    drawResizedText(context, card.site.locality, 70, 94, titleMaxWidth, {
      weight: 700,
      maxSize: 58,
      minSize: 30
    });

    drawStatusPill(context, statusLabel, accent, statusPillX, 66);
    context.textBaseline = "alphabetic";

    const rowsStartY = 190;
    const rowHeight = 51;

    for (let index = 0; index < card.rows.length; index++) {
      const row = card.rows[index];
      const rowAge =
        age -
        DEMO_ANIMATION.cardDrawMs -
        index * DEMO_ANIMATION.cardRowStaggerMs;
      const rowProgress = clamp01(rowAge / DEMO_ANIMATION.cardRowRevealMs);

      if (rowProgress <= 0) {
        continue;
      }

      const y = rowsStartY + index * rowHeight;
      const settled = rowAge >= DEMO_ANIMATION.cardCheckingMs;
      const rowAccent = row.status ? STATUS_COLORS[row.status] : "#f5f7fb";
      const value = row.checkable && !settled ? "Checking..." : row.value;

      context.globalAlpha = rowProgress;
      fillRoundRect(
        context,
        64,
        y - 28,
        width - 128,
        39,
        15,
        hexToRgba(rowAccent, row.status ? 0.14 : 0.07)
      );
      context.font = "700 22px Inter, sans-serif";
      context.fillStyle = "#aeb8c7";
      drawFittedText(context, row.label, 90, y - 1, 310);

      context.font = "700 25px Inter, sans-serif";
      context.fillStyle = row.status && settled ? rowAccent : "#f5f7fb";
      drawFittedText(context, value, 430, y - 1, width - 530);
      context.globalAlpha = 1;
    }

    context.restore();
    card.texture.needsUpdate = true;
  }

  private enforceDemoCardLimit(now: number): void {
    const retainedCards = this.demoCards.filter(
      (card) => card.fadeStartedAt === null
    );
    const extraCount = retainedCards.length - DEMO_ANIMATION.maxRetainedCards;

    if (extraCount <= 0) {
      return;
    }

    for (const card of retainedCards.slice(0, extraCount)) {
      card.fadeStartedAt = now;
    }
  }

  private fadeDemoCards(now: number): void {
    for (const card of this.demoCards) {
      card.fadeStartedAt ??= now;
    }
  }

  private clearDemoCards(): void {
    for (const card of [...this.demoCards]) {
      this.disposeDemoCard(card);
    }
  }

  private disposeDemoCard(card: DemoCardVisual): void {
    const index = this.demoCards.indexOf(card);

    if (index >= 0) {
      this.demoCards.splice(index, 1);
    }

    if (this.activeDemoCard === card) {
      this.activeDemoCard = null;
    }

    card.texture.dispose();
    card.group.traverse((object) => this.disposeObjectResources(object));
    this.demoCardGroup.remove(card.group);
  }

  private isDemoCardInView(card: DemoCardVisual): boolean {
    const projected = card.group.position.clone().project(this.camera);

    return (
      projected.z >= -1 &&
      projected.z <= 1 &&
      Math.abs(projected.x) <= 1.14 &&
      Math.abs(projected.y) <= 1.14
    );
  }

  private getDemoCardViewportScale(): number {
    if (this.camera.aspect >= 1) {
      return 1;
    }

    return THREE.MathUtils.clamp(this.camera.aspect * 0.84, 0.34, 1);
  }

  private disposeObjectResources(object: THREE.Object3D): void {
    const renderable = object as THREE.Object3D & {
      geometry?: { dispose: () => void };
      material?: THREE.Material | THREE.Material[];
    };

    renderable.geometry?.dispose();

    if (Array.isArray(renderable.material)) {
      for (const material of renderable.material) {
        material.dispose();
      }
    } else if (renderable.material) {
      renderable.material.dispose();
    }
  }

  private addLights(): void {
    const ambient = new THREE.HemisphereLight("#d9f7ff", "#0c141d", 0.78);
    const key = new THREE.DirectionalLight("#ffffff", 2.2);
    const fill = new THREE.DirectionalLight("#31d7ff", 0.62);

    key.position.set(-140, 220, 120);
    key.castShadow = true;
    key.shadow.mapSize.width = 2048;
    key.shadow.mapSize.height = 2048;
    key.shadow.camera.left = -180;
    key.shadow.camera.right = 180;
    key.shadow.camera.top = 180;
    key.shadow.camera.bottom = -180;
    fill.position.set(180, 120, -160);
    this.scene.add(ambient, key, fill);
  }

  private createStars(): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    const count = 1300;
    const positions = new Float32Array(count * 3);

    for (let index = 0; index < count; index++) {
      const radius = 620 + Math.random() * 760;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[index * 3 + 2] = radius * Math.cos(phi);
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: "#d9f7ff",
        size: 1.15,
        transparent: true,
        opacity: 0.68,
        depthWrite: false
      })
    );
  }

  private refreshMapColors(): void {
    const dark = this.theme === "dark";

    this.landMaterial.color.set(dark ? "#123a44" : "#edf5f2");
    this.landMaterial.emissive.set(dark ? "#071820" : "#9fb5c4");
    this.landMaterial.emissiveIntensity = dark ? 0.16 : 0.04;

    this.nzMaterial.color.set(dark ? "#2c7b6f" : "#d7f0e7");
    this.nzMaterial.emissive.set(dark ? "#0d302b" : "#78aa97");
    this.nzMaterial.emissiveIntensity = dark ? 0.24 : 0.08;

    this.oceanMaterial.color.set(dark ? "#061018" : "#d8e6ef");
    this.oceanMaterial.opacity = dark ? 0.9 : 0.96;
    this.oceanMaterial.emissive.set(dark ? "#02070b" : "#8aaabc");
    this.oceanMaterial.emissiveIntensity = dark ? 0.22 : 0.05;

    this.borderMaterial.color.set(dark ? "#81d4fa" : "#006f9f");
    this.borderMaterial.opacity = dark ? 0.24 : 0.28;
    this.nzBorderMaterial.color.set(dark ? "#d9fff4" : "#007a5d");
    this.nzBorderMaterial.opacity = dark ? 0.72 : 0.62;
    this.gridMaterial.color.set(dark ? "#31d7ff" : "#006f9f");
    this.gridMaterial.opacity = dark ? 0.1 : 0.16;
  }

  private animate = (): void => {
    if (this.disposed) {
      return;
    }

    const now = performance.now();
    const elapsed = (now - this.startedAt) / 1000;
    this.cameraRig.update();
    const zoomStyle = this.updateMarkers(elapsed, now);
    this.updateLinks(elapsed, zoomStyle);
    this.updateDemoCards(now);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private updateMarkers(elapsed: number, now: number): MarkerZoomStyle {
    const zoomStyle = getMarkerZoomStyle({
      baseScale: STATUS_MARKER_SCALE,
      distance: this.cameraRig.getDistanceToTarget(),
      minDistance: this.cameraRig.getMinDistance(),
      referenceDistance: this.cameraRig.getDefaultDistance()
    });
    const releaseProgress =
      this.demoMarkerFocusReleasedAt === null
        ? 0
        : clamp01(
            (now - this.demoMarkerFocusReleasedAt) / DEMO_ACTIVE_MARKER.releaseMs
          );

    if (this.demoMarkerFocusReleasedAt !== null && releaseProgress >= 1) {
      this.clearDemoMarkerFocus();
    }

    const hasFocusedDemoMarker = this.demoActive && this.demoFocusedSiteId !== null;
    const focusAgeMs = Math.max(0, now - this.demoMarkerFocusStartedAt);
    const enterProgress = clamp01(focusAgeMs / DEMO_ACTIVE_MARKER.enterMs);
    const enterStrength = easeInOutSine(enterProgress);
    const releaseStrength =
      this.demoMarkerFocusReleasedAt === null
        ? 1
        : 1 - easeInOutSine(releaseProgress);
    const activeMarkerStrength = enterStrength * releaseStrength;
    const flashProgress = clamp01(focusAgeMs / DEMO_ACTIVE_MARKER.flashMs);
    const flash =
      flashProgress < 1
        ? (1 - flashProgress) *
          (0.7 + 0.3 * ((Math.sin(focusAgeMs / 54) + 1) / 2)) *
          activeMarkerStrength
        : 0;

    for (const marker of this.markers) {
      const wave = (Math.sin(elapsed * marker.speed + marker.phase) + 1) / 2;
      const activeWave =
        (Math.sin(elapsed * DEMO_ACTIVE_MARKER.pulseSpeed + marker.phase) + 1) /
        2;
      const isFocusedDemoMarker =
        hasFocusedDemoMarker && marker.site.id === this.demoFocusedSiteId;
      const alertPulse = 1 + marker.alertStrength * 0.48 * wave;
      const calmPulse = 1 + 0.14 * wave;
      let baseScale = (1 + marker.alertStrength * 0.25) * calmPulse;
      let beamScale = alertPulse;
      let beamWidthScale = 1;
      let beamOpacity = 0.12 + marker.alertStrength * (0.24 + wave * 0.26);
      let ringScale = 1 + wave * (0.42 + marker.alertStrength * 0.54);
      let ringOpacity = 0.18 + wave * (0.25 + marker.alertStrength * 0.2);

      marker.base.material.color.copy(marker.statusColor);
      marker.base.material.opacity = 0.96;

      marker.group.scale.setScalar(zoomStyle.groupScale);

      if (isFocusedDemoMarker) {
        marker.base.material.color.lerp(
          this.activeMarkerFlashColor,
          THREE.MathUtils.clamp(
            activeMarkerStrength * 0.18 * activeWave + flash * 0.82,
            0,
            1
          )
        );
        marker.base.material.opacity = 0.96 + activeMarkerStrength * 0.04;
        baseScale *=
          1 +
          activeMarkerStrength *
            (DEMO_ACTIVE_MARKER.activeBaseScaleBoost +
              DEMO_ACTIVE_MARKER.activeBasePulseScale * activeWave) +
          flash * 0.18;
        beamScale +=
          activeMarkerStrength *
            (DEMO_ACTIVE_MARKER.activeBeamScaleBoost + activeWave * 0.28) +
          flash * 0.18;
        beamWidthScale += activeMarkerStrength * activeWave * 0.16 + flash * 0.12;
        beamOpacity +=
          activeMarkerStrength *
            (DEMO_ACTIVE_MARKER.activeBeamOpacityBoost + activeWave * 0.15) +
          flash * 0.2;
        ringScale += activeMarkerStrength * activeWave * 0.36 + flash * 0.24;
        ringOpacity += activeMarkerStrength * activeWave * 0.25 + flash * 0.22;

        marker.activeGlow.visible = true;
        marker.activeGlow.scale.setScalar(
          1 +
            activeMarkerStrength *
              (DEMO_ACTIVE_MARKER.activeGlowBaseScale -
                1 +
                activeWave * DEMO_ACTIVE_MARKER.activeGlowPulseScale) +
            flash * 0.42
        );
        marker.activeGlow.material.opacity =
          (activeMarkerStrength * (0.16 + activeWave * 0.1) + flash * 0.28) *
          zoomStyle.effectOpacityMultiplier;

        marker.activeHalo.visible = true;
        marker.activeHalo.scale.setScalar(
          1 +
            activeMarkerStrength *
              (DEMO_ACTIVE_MARKER.activeHaloBaseScale -
                1 +
                activeWave * DEMO_ACTIVE_MARKER.activeHaloPulseScale) +
            flash * 0.34
        );
        marker.activeHalo.material.opacity =
          (activeMarkerStrength * (0.46 + activeWave * 0.28) + flash * 0.22) *
          zoomStyle.effectOpacityMultiplier;
        this.updateActiveOrbitRings(
          marker,
          focusAgeMs,
          activeMarkerStrength,
          zoomStyle.effectOpacityMultiplier
        );
      } else {
        marker.activeGlow.visible = false;
        marker.activeGlow.material.opacity = 0;
        marker.activeHalo.visible = false;
        marker.activeHalo.material.opacity = 0;
        this.hideActiveOrbitRings(marker);
      }

      marker.base.scale.setScalar(baseScale);
      marker.beam.scale.set(beamWidthScale, beamScale, beamWidthScale);
      marker.beam.material.opacity = THREE.MathUtils.clamp(
        beamOpacity * zoomStyle.effectOpacityMultiplier,
        0,
        0.92
      );
      marker.ring.scale.setScalar(ringScale);
      marker.ring.material.opacity = THREE.MathUtils.clamp(
        ringOpacity * zoomStyle.effectOpacityMultiplier,
        0,
        0.96
      );
    }

    return zoomStyle;
  }

  private updateActiveOrbitRings(
    marker: MarkerVisual,
    focusAgeMs: number,
    activeMarkerStrength: number,
    effectOpacityMultiplier: number
  ): void {
    for (let index = 0; index < marker.activeOrbitRings.length; index++) {
      const orbitRing = marker.activeOrbitRings[index];
      const delayedAge =
        focusAgeMs - index * DEMO_ACTIVE_MARKER.orbitRingStaggerMs;

      if (delayedAge < 0 || activeMarkerStrength <= 0) {
        orbitRing.visible = false;
        orbitRing.material.opacity = 0;
        continue;
      }

      const progress =
        (delayedAge % DEMO_ACTIVE_MARKER.orbitRingDurationMs) /
        DEMO_ACTIVE_MARKER.orbitRingDurationMs;
      const expansion = easeOutCubic(progress);
      const fade = (1 - progress) ** 1.8;

      orbitRing.visible = true;
      orbitRing.scale.setScalar(
        DEMO_ACTIVE_MARKER.orbitRingBaseScale +
          expansion * DEMO_ACTIVE_MARKER.orbitRingExpandScale
      );
      orbitRing.material.opacity =
        fade *
        DEMO_ACTIVE_MARKER.orbitRingOpacity *
        effectOpacityMultiplier *
        activeMarkerStrength;
    }
  }

  private hideActiveOrbitRings(marker: MarkerVisual): void {
    for (const orbitRing of marker.activeOrbitRings) {
      orbitRing.visible = false;
      orbitRing.material.opacity = 0;
    }
  }

  private updateLinks(
    elapsed: number,
    zoomStyle = getMarkerZoomStyle({
      baseScale: STATUS_MARKER_SCALE,
      distance: this.cameraRig.getDistanceToTarget(),
      minDistance: this.cameraRig.getMinDistance(),
      referenceDistance: this.cameraRig.getDefaultDistance()
    })
  ): void {
    const delta = Math.min(0.18, Math.max(0, elapsed - this.previousLinkElapsed));
    this.previousLinkElapsed = elapsed;

    for (const link of this.links) {
      let hasActivePackets = false;
      const speed = this.linksVisible ? link.speed : link.speed * 1.3;

      for (let index = 0; index < link.packets.length; index++) {
        const packet = link.packets[index];
        const wasSent = packet.progress >= 0;

        if (this.linksVisible || wasSent) {
          packet.progress += delta * speed;
        }

        if (this.linksVisible) {
          while (packet.progress >= 1) {
            packet.progress -= 1;
          }
        }

        if (packet.progress < 0 || packet.progress >= 1) {
          packet.mesh.visible = false;
          continue;
        }

        const pulse = (Math.sin((elapsed * 3.8 + index) * Math.PI) + 1) / 2;
        const edgeFade = Math.min(1, packet.progress * 12, (1 - packet.progress) * 12);

        packet.mesh.visible = true;
        packet.mesh.position.copy(link.curve.getPointAt(packet.progress));
        packet.mesh.scale.setScalar(
          (0.82 + pulse * 0.28) * zoomStyle.worldScaleMultiplier
        );
        packet.mesh.material.opacity =
          edgeFade *
          (0.62 + pulse * 0.32) *
          zoomStyle.effectOpacityMultiplier;
        hasActivePackets = true;
      }

      link.group.visible = this.linksVisible || hasActivePackets;
    }
  }

  private projectLatLng(lat: number, lng: number, y = 0): THREE.Vector3 {
    const deltaLng = normalizeLngDelta(lng);

    return this.projectDelta(deltaLng, lat, y);
  }

  private projectDelta(deltaLng: number, lat: number, y = 0): THREE.Vector3 {
    return new THREE.Vector3(
      deltaLng * LON_SCALE,
      y,
      (NZ_TARGET.lat - lat) * MAP_SCALE
    );
  }

  private getNzTarget(): THREE.Vector3 {
    const target = this.projectLatLng(
      NZ_TARGET.lat,
      NZ_TARGET.lng,
      COUNTRY_DEPTH + 1.5
    );
    target.x -= 1.6;
    target.z += 0.8;

    return target;
  }

  private createLine(
    points: THREE.Vector3[],
    material: THREE.LineBasicMaterial
  ): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
    const closed = closePoints(points);
    const geometry = new THREE.BufferGeometry().setFromPoints(closed);
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 2;

    return line;
  }

  private onResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.cameraRig.updateAspect(width, height);
    this.renderer.setSize(width, height);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.demoActive) {
      this.clearHover();
      return;
    }

    this.updatePointerMoved(event.clientX, event.clientY);
    const site = this.getSiteAtPoint(event.clientX, event.clientY);

    if (!site) {
      this.clearHover();
      return;
    }

    this.renderer.domElement.style.cursor = "pointer";
    this.onMarkerHover?.(site, { x: event.clientX, y: event.clientY });
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDownPoint = { x: event.clientX, y: event.clientY };
    this.pointerMovedAfterDown = false;
  };

  private onClick = (event: MouseEvent): void => {
    if (this.demoActive) {
      return;
    }

    if (this.pointerMovedAfterDown) {
      return;
    }

    const site = this.getSiteAtPoint(event.clientX, event.clientY);

    if (site) {
      this.onMarkerClick?.(site);
    }
  };

  private clearHover = (): void => {
    this.renderer.domElement.style.cursor = "";
    this.onMarkerHover?.(null);
  };

  private updatePointerMoved(clientX: number, clientY: number): void {
    if (!this.pointerDownPoint || this.pointerMovedAfterDown) {
      return;
    }

    const distance = Math.hypot(
      clientX - this.pointerDownPoint.x,
      clientY - this.pointerDownPoint.y
    );

    this.pointerMovedAfterDown = distance > MARKER_CLICK_DRAG_TOLERANCE_PX;
  }

  private getSiteAtPoint(clientX: number, clientY: number): SiteMarker | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.markerPickCandidates.length = 0;

    for (const marker of this.markers) {
      const projected = this.markerProjection
        .copy(marker.group.position)
        .project(this.camera);

      this.markerPickCandidates.push({
        item: marker.site,
        screenX: ((projected.x + 1) / 2) * rect.width,
        screenY: ((-projected.y + 1) / 2) * rect.height,
        ndcX: projected.x,
        ndcY: projected.y,
        ndcZ: projected.z
      });
    }

    return pickNearestProjectedMarker(
      { x: clientX - rect.left, y: clientY - rect.top },
      this.markerPickCandidates,
      MARKER_PICK_RADIUS_PX
    );
  }
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;

  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function easeInOutSine(value: number): number {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function fillRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string
): void {
  context.fillStyle = fillStyle;
  createRoundRectPath(context, x, y, width, height, radius);
  context.fill();
}

function strokeRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeStyle: string,
  lineWidth: number
): void {
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  createRoundRectPath(context, x, y, width, height, radius);
  context.stroke();
}

function createRoundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
): void {
  if (context.measureText(text).width <= maxWidth) {
    context.fillText(text, x, y);
    return;
  }

  let fitted = text;

  while (fitted.length > 3 && context.measureText(`${fitted}...`).width > maxWidth) {
    fitted = fitted.slice(0, -1);
  }

  context.fillText(`${fitted}...`, x, y);
}

function drawResizedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  options: { weight: number; maxSize: number; minSize: number }
): void {
  for (let size = options.maxSize; size >= options.minSize; size -= 1) {
    context.font = `${options.weight} ${size}px Inter, sans-serif`;

    if (context.measureText(text).width <= maxWidth) {
      context.fillText(text, x, y);
      return;
    }
  }

  context.font = `${options.weight} ${options.minSize}px Inter, sans-serif`;
  drawFittedText(context, text, x, y, maxWidth);
}

function measureStatusPillWidth(
  context: CanvasRenderingContext2D,
  label: string
): number {
  context.font = "800 25px Inter, sans-serif";
  return Math.ceil(context.measureText(label.toUpperCase()).width + 48);
}

function drawStatusPill(
  context: CanvasRenderingContext2D,
  label: string,
  color: string,
  x: number,
  y: number
): void {
  const width = measureStatusPillWidth(context, label);

  fillRoundRect(context, x, y, width, 56, 22, hexToRgba(color, 0.22));
  strokeRoundRect(context, x, y, width, 56, 22, hexToRgba(color, 0.86), 3);
  context.textBaseline = "middle";
  context.font = "800 25px Inter, sans-serif";
  context.fillStyle = color;
  context.fillText(label.toUpperCase(), x + 24, y + 28);
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getCountries(): FeatureCollection<Geometry, CountryProperties> {
  const topology = countries50m as unknown as Topology<{
    countries: GeometryCollection;
  }>;

  return feature(topology, topology.objects.countries) as unknown as FeatureCollection<
    Geometry,
    CountryProperties
  >;
}

function isPolygonGeometry(geometry: Geometry): geometry is Polygon | MultiPolygon {
  return geometry.type === "Polygon" || geometry.type === "MultiPolygon";
}

function getPolygons(geometry: Polygon | MultiPolygon): Position[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function createShape(polygon: Position[][]): THREE.Shape | null {
  const [outerRing, ...holeRings] = polygon;

  if (!outerRing) {
    return null;
  }

  const outerPoints = ensureClockwise(projectRingToShape(outerRing));

  if (outerPoints.length < 3) {
    return null;
  }

  const shape = new THREE.Shape(outerPoints);

  for (const holeRing of holeRings) {
    const holePoints = ensureCounterClockwise(projectRingToShape(holeRing));

    if (holePoints.length >= 3) {
      shape.holes.push(new THREE.Path(holePoints));
    }
  }

  return shape;
}

function projectRingToShape(ring: Position[]): THREE.Vector2[] {
  let previousDelta: number | null = null;
  const points: THREE.Vector2[] = [];

  for (const position of ring) {
    const lng = Number(position[0]);
    const lat = Number(position[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }

    let deltaLng = normalizeLngDelta(lng);

    if (previousDelta !== null) {
      while (deltaLng - previousDelta > 180) {
        deltaLng -= 360;
      }

      while (deltaLng - previousDelta < -180) {
        deltaLng += 360;
      }
    }

    previousDelta = deltaLng;
    points.push(
      new THREE.Vector2(deltaLng * LON_SCALE, (lat - NZ_TARGET.lat) * MAP_SCALE)
    );
  }

  return points;
}

function projectRingToWorld(ring: Position[], y: number): THREE.Vector3[] {
  return projectRingToShape(ring).map((point) => new THREE.Vector3(point.x, y, -point.y));
}

function normalizeLngDelta(lng: number): number {
  let delta = lng - NZ_TARGET.lng;

  while (delta < -180) {
    delta += 360;
  }

  while (delta >= 180) {
    delta -= 360;
  }

  return delta;
}

function ensureClockwise(points: THREE.Vector2[]): THREE.Vector2[] {
  return THREE.ShapeUtils.isClockWise(points) ? points : [...points].reverse();
}

function ensureCounterClockwise(points: THREE.Vector2[]): THREE.Vector2[] {
  return THREE.ShapeUtils.isClockWise(points) ? [...points].reverse() : points;
}

function closePoints(points: THREE.Vector3[]): THREE.Vector3[] {
  const [first] = points;
  const last = points.at(-1);

  if (!first || !last || first.distanceToSquared(last) < 0.0001) {
    return points;
  }

  return [...points, first.clone()];
}

function getLinkArcLift(distance: number): number {
  return THREE.MathUtils.clamp(0.24 + distance * 0.52, 0.18, 3.4);
}

function getLinkPacketSpeed(link: LinkArc): number {
  const baseSpeed = link.type === "900M" ? 0.58 : 0.5;
  const variance = (hashString(link.id) % 9) * 0.012;

  return baseSpeed + variance;
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }

  return hash;
}

function getAlertStrength(status: RimuStatus): number {
  switch (status) {
    case "bad":
      return 1;
    case "overdue":
      return 0.85;
    case "warning":
      return 0.65;
    case "acknowledged":
      return 0.35;
    case "unknown":
      return 0.2;
    case "ok":
    default:
      return 0.08;
  }
}

export function renderLegend(
  container: HTMLElement,
  visibleStatuses: ReadonlySet<RimuStatus>
): void {
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Toggle map marker statuses");
  container.replaceChildren(
    ...RIMU_STATUSES.map((status) => {
      const label = STATUS_LABELS[status];
      const active = visibleStatuses.has(status);
      const button = document.createElement("button");
      const swatch = document.createElement("span");
      const buttonLabel = document.createElement("span");

      button.type = "button";
      button.className = "legend-button";
      button.dataset.status = status;
      button.style.setProperty("--status-color", STATUS_COLORS[status]);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", `${active ? "Hide" : "Show"} ${label} markers`);
      button.classList.toggle("is-active", active);

      swatch.className = "legend-swatch";
      swatch.setAttribute("aria-hidden", "true");

      buttonLabel.className = "legend-label";
      buttonLabel.textContent = label;

      button.append(swatch, buttonLabel);

      return button;
    })
  );
}
