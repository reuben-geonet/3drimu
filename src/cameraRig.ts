import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface CameraTween {
  startedAt: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  targetFrom: THREE.Vector3;
  targetTo: THREE.Vector3;
  onDone?: () => void;
}

interface MapCameraRigOptions {
  aspect: number;
  domElement: HTMLElement;
  target: THREE.Vector3;
}

const PAN_BOUNDS = {
  minX: -86,
  maxX: 86,
  minZ: -92,
  maxZ: 54
};

const CAMERA_VIEW = {
  // Narrower than the default 42 so the final frame is NZ-first on wide screens.
  fov: 36,
  near: 0.1,
  far: 2200,

  // Three.js world axes here are X = west/east, Y = height, Z = north/south.
  // This is the settled, user-facing NZ frame. Keep this stable unless the
  // desired final composition changes.
  finalOffset: new THREE.Vector3(0, 18, 30),

  // The intro starts farther along the same camera line, then eases into
  // finalOffset. This may sit beyond maxDistance because controls are disabled
  // during the intro.
  introOffset: new THREE.Vector3(20, 55, 95),

  // User zoom bounds after the intro. maxDistance is intentionally tight so the
  // map edge and empty background cannot be revealed by zooming out.
  minDistance: 4.5,
  maxDistance: 46,

  introDurationMs: 2600,
  resetDurationMs: 1200,
  zoomSpeed: 0.72,
  panSpeed: 0.86
};

export class MapCameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private readonly controls: OrbitControls;
  private readonly targetY: number;
  private cameraTween: CameraTween | null = null;

  constructor(options: MapCameraRigOptions) {
    this.targetY = options.target.y;
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_VIEW.fov,
      options.aspect,
      CAMERA_VIEW.near,
      CAMERA_VIEW.far
    );

    this.controls = new OrbitControls(this.camera, options.domElement);
    this.controls.enableDamping = true;
    this.controls.enabled = false;
    this.controls.enableRotate = false;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.minDistance = CAMERA_VIEW.minDistance;
    this.controls.maxDistance = CAMERA_VIEW.maxDistance;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI / 2.08;
    this.controls.zoomSpeed = CAMERA_VIEW.zoomSpeed;
    this.controls.panSpeed = CAMERA_VIEW.panSpeed;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    this.controls.target.copy(options.target);
    this.camera.position.copy(this.getIntroCameraPosition(options.target));
    this.camera.lookAt(options.target);
  }

  startIntro(target: THREE.Vector3): Promise<void> {
    this.controls.enabled = false;

    return new Promise((resolve) => {
      this.cameraTween = {
        startedAt: performance.now(),
        duration: CAMERA_VIEW.introDurationMs,
        from: this.camera.position.clone(),
        to: this.getFinalCameraPosition(target),
        targetFrom: this.controls.target.clone(),
        targetTo: target,
        onDone: () => {
          this.controls.target.copy(target);
          this.constrainCamera();
          this.controls.enabled = true;
          resolve();
        }
      };
    });
  }

  resetView(target: THREE.Vector3): void {
    this.controls.enabled = false;
    this.cameraTween = {
      startedAt: performance.now(),
      duration: CAMERA_VIEW.resetDurationMs,
      from: this.camera.position.clone(),
      to: this.getFinalCameraPosition(target),
      targetFrom: this.controls.target.clone(),
      targetTo: target,
      onDone: () => {
        this.controls.target.copy(target);
        this.constrainCamera();
        this.controls.enabled = true;
      }
    };
  }

  update(): void {
    this.updateCameraTween();

    if (!this.controls.enabled) {
      return;
    }

    this.controls.update();
    this.constrainCamera();
  }

  updateAspect(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.controls.dispose();
  }

  private getIntroCameraPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.clone().add(CAMERA_VIEW.introOffset);
  }

  private getFinalCameraPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.clone().add(CAMERA_VIEW.finalOffset);
  }

  private updateCameraTween(): void {
    if (!this.cameraTween) {
      return;
    }

    const progress = Math.min(
      1,
      (performance.now() - this.cameraTween.startedAt) / this.cameraTween.duration
    );
    const eased = easeInOutCubic(progress);
    const cameraPosition = new THREE.Vector3().lerpVectors(
      this.cameraTween.from,
      this.cameraTween.to,
      eased
    );
    const target = new THREE.Vector3().lerpVectors(
      this.cameraTween.targetFrom,
      this.cameraTween.targetTo,
      eased
    );

    this.camera.position.copy(cameraPosition);
    this.controls.target.copy(target);
    this.camera.lookAt(target);

    if (progress >= 1) {
      const onDone = this.cameraTween.onDone;
      this.cameraTween = null;
      onDone?.();
    }
  }

  private constrainCamera(): void {
    const target = this.controls.target;
    const clampedX = THREE.MathUtils.clamp(
      target.x,
      PAN_BOUNDS.minX,
      PAN_BOUNDS.maxX
    );
    const clampedZ = THREE.MathUtils.clamp(
      target.z,
      PAN_BOUNDS.minZ,
      PAN_BOUNDS.maxZ
    );
    const correction = new THREE.Vector3(
      clampedX - target.x,
      this.targetY - target.y,
      clampedZ - target.z
    );

    if (correction.lengthSq() < 0.000001) {
      return;
    }

    target.add(correction);
    this.camera.position.add(correction);
  }
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
