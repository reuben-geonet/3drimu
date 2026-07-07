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
import { RIMU_STATUSES, STATUS_COLORS, STATUS_LABELS } from "./status";
import type { LinkArc, RimuStatus, SiteMarker } from "./types";

interface MarkerVisual {
  site: SiteMarker;
  group: THREE.Group;
  base: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
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

interface MapSceneOptions {
  onMarkerHover?: (
    site: SiteMarker | null,
    point?: { x: number; y: number }
  ) => void;
  onMarkerClick?: (site: SiteMarker) => void;
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
  private readonly markers: MarkerVisual[] = [];
  private readonly links: LinkVisual[] = [];
  private readonly pickables: THREE.Object3D[] = [];
  private readonly visibleStatuses = new Set<RimuStatus>(RIMU_STATUSES);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly startedAt = performance.now();
  private readonly onMarkerHover?: MapSceneOptions["onMarkerHover"];
  private readonly onMarkerClick?: MapSceneOptions["onMarkerClick"];
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

  constructor(container: HTMLElement, options: MapSceneOptions = {}) {
    this.container = container;
    this.onMarkerHover = options.onMarkerHover;
    this.onMarkerClick = options.onMarkerClick;
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
    this.scene.add(this.linkGroup, this.markerGroup);
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
  }

  getVisibleSiteCount(): number {
    return this.getVisibleSites().length;
  }

  startIntro(): Promise<void> {
    return this.cameraRig.startIntro(this.getNzTarget());
  }

  resetView(): void {
    this.cameraRig.resetView(this.getNzTarget());
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.onResize);
    this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.renderer.domElement.removeEventListener("pointerleave", this.clearHover);
    this.cameraRig.dispose();
    this.renderer.dispose();
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
      base.userData.site = site;

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
      beam.userData.site = site;

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
      ring.userData.site = site;

      group.add(base, beam, ring);
      this.markerGroup.add(group);
      this.pickables.push(base, beam, ring);
      this.markers.push({
        site,
        group,
        base,
        beam,
        ring,
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
    return this.sites.filter((site) => this.visibleStatuses.has(site.status));
  }

  private clearMarkers(): void {
    for (const marker of this.markers) {
      marker.group.traverse((object) => this.disposeObjectResources(object));
    }

    this.markerGroup.clear();
    this.markers.length = 0;
    this.pickables.length = 0;
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

    const elapsed = (performance.now() - this.startedAt) / 1000;
    this.updateMarkers(elapsed);
    this.updateLinks(elapsed);
    this.cameraRig.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private updateMarkers(elapsed: number): void {
    for (const marker of this.markers) {
      const wave = (Math.sin(elapsed * marker.speed + marker.phase) + 1) / 2;
      const alertPulse = 1 + marker.alertStrength * 0.48 * wave;
      const calmPulse = 1 + 0.14 * wave;

      marker.base.scale.setScalar((1 + marker.alertStrength * 0.25) * calmPulse);
      marker.beam.scale.set(1, alertPulse, 1);
      marker.beam.material.opacity = 0.12 + marker.alertStrength * (0.24 + wave * 0.26);
      marker.ring.scale.setScalar(1 + wave * (0.42 + marker.alertStrength * 0.54));
      marker.ring.material.opacity = 0.18 + wave * (0.25 + marker.alertStrength * 0.2);
    }
  }

  private updateLinks(elapsed: number): void {
    const delta = Math.min(0.05, Math.max(0, elapsed - this.previousLinkElapsed));
    this.previousLinkElapsed = elapsed;

    for (const link of this.links) {
      let hasActivePackets = false;

      for (let index = 0; index < link.packets.length; index++) {
        const packet = link.packets[index];
        const wasSent = packet.progress >= 0;

        if (this.linksVisible || wasSent) {
          packet.progress += delta * link.speed;
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
        packet.mesh.scale.setScalar(0.82 + pulse * 0.28);
        packet.mesh.material.opacity = edgeFade * (0.62 + pulse * 0.32);
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
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    const site = hit?.object.userData.site as SiteMarker | undefined;

    return site ?? null;
  }
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
