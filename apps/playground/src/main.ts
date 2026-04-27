import {
  ClipMode,
  collectPointCloudDiagnostics,
  createClipBox,
  createClipSphere,
  createPointCloudOctree,
  type IVisibilityUpdateResult,
  type LoadedPointCloud,
  LocalPotreeRequestManager,
  type PointCloudOctree,
  PointColorType,
  PointShape,
  PointSizeType,
  Potree,
  type PotreeLoadMeasurement,
  type PotreeLoadStage,
  PotreeRenderer,
  pickPointClouds,
  updatePointClouds,
} from "potree-core/renderer-three";
import Stats from "stats.js";
import {
  AmbientLight,
  BoxGeometry,
  Euler,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneHelper,
  Raycaster,
  Scene,
  SphereGeometry,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { GUI } from "three/examples/jsm/libs/lil-gui.module.min.js";
import { toThreeBox3 } from "../../../packages/core/src/renderer-three/math/box3-like";
import "./style.css";

document.body.onload = () => {
  const potree = new Potree();
  const loadMetrics = createLoadMetrics();
  const pointClouds: PointCloudOctree[] = [];
  let clipSphereHelperMesh: Mesh | null = null;
  let clipBoxesActive = false;
  let clipPlanesActive = false;

  type ClipPlaneAxis = "X" | "Y" | "Z";
  type ClipPlaneEntry = {
    id: number;
    axis: ClipPlaneAxis;
    offset: number;
    enabled: boolean;
    plane: Plane;
    helper: PlaneHelper;
  };
  type ClipBoxEntry = {
    id: number;
    offsetX: number;
    offsetY: number;
    offsetZ: number;
    scale: number;
    enabled: boolean;
    helper: Mesh;
  };
  type ClipPlanePresetEntry = {
    axis: ClipPlaneAxis;
    enabled: boolean;
    offset: number;
  };
  type ClipBoxPresetEntry = {
    enabled: boolean;
    offsetX: number;
    offsetY: number;
    offsetZ: number;
    scale: number;
  };
  const clipPlaneColors: Record<ClipPlaneAxis, number> = {
    X: 0xe53935,
    Y: 0x43a047,
    Z: 0x1e88e5,
  };
  const planeCenter = new Vector3();
  const planeExtent = new Vector3();
  const clipBoxCenter = new Vector3();
  const clipBoxExtent = new Vector3();
  const clipPlaneEntries: ClipPlaneEntry[] = [];
  const clipBoxEntries: ClipBoxEntry[] = [];
  let nextClipPlaneId = 1;
  let nextClipBoxId = 1;
  let clipPlaneFolder: GUI | null = null;
  let clipBoxFolder: GUI | null = null;

  const clippingUiState = {
    showPlaneHelpers: true,
    showBoxHelpers: true,
    addClipPlane: () => {
      addClipPlaneEntry({
        axis: (["X", "Y", "Z"] as const)[clipPlaneEntries.length % 3],
        enabled: true,
        offset: 0,
      });
      renderClipPlaneFolder();
      updateClipPlanes();
      markPresetCustom();
    },
    addClipBox: () => {
      const index = clipBoxEntries.length;
      const offsetStep = Math.min(index * 0.15, 0.75);
      addClipBoxEntry({
        offsetX: offsetStep,
        offsetY: 0,
        offsetZ: 0,
        scale: 1,
        enabled: true,
      });
      renderClipBoxFolder();
      updateClipBoxes();
      markPresetCustom();
    },
  };

  const helperSize = 1;

  function setPlaneNormal(plane: Plane, axis: ClipPlaneAxis) {
    if (axis === "X") {
      plane.normal.set(1, 0, 0);
    } else if (axis === "Y") {
      plane.normal.set(0, 1, 0);
    } else {
      plane.normal.set(0, 0, 1);
    }
  }

  function updateClipPlanes() {
    const hasTarget = clipPlanesActive && pointClouds.length > 0;
    for (const entry of clipPlaneEntries) {
      setPlaneNormal(entry.plane, entry.axis);
      const center =
        entry.axis === "X"
          ? planeCenter.x
          : entry.axis === "Y"
            ? planeCenter.y
            : planeCenter.z;
      const extent =
        entry.axis === "X"
          ? planeExtent.x
          : entry.axis === "Y"
            ? planeExtent.y
            : planeExtent.z;
      entry.plane.constant = -(center + entry.offset * extent);
      entry.helper.visible =
        hasTarget && clippingUiState.showPlaneHelpers && entry.enabled;
    }

    const planes = hasTarget
      ? clipPlaneEntries
          .filter((entry) => entry.enabled)
          .map((entry) => entry.plane)
      : [];
    for (const pointCloud of pointClouds) {
      pointCloud.material.clippingPlanes = planes.length > 0 ? planes : null;
    }
  }

  function updateClipBoxes() {
    const hasTarget = clipBoxesActive && pointClouds.length > 0;
    const clipBoxes = hasTarget
      ? clipBoxEntries
          .filter((entry) => entry.enabled)
          .map((entry) => {
            const position = new Vector3(
              clipBoxCenter.x + entry.offsetX * clipBoxExtent.x,
              clipBoxCenter.y + entry.offsetY * clipBoxExtent.y,
              clipBoxCenter.z + entry.offsetZ * clipBoxExtent.z,
            );
            const size = clipBoxExtent.clone().multiplyScalar(entry.scale);
            entry.helper.position.copy(position);
            entry.helper.scale.copy(size);
            entry.helper.visible = clippingUiState.showBoxHelpers;
            return createClipBox(size, position);
          })
      : [];

    for (const entry of clipBoxEntries) {
      if (!hasTarget || !entry.enabled) {
        entry.helper.visible = false;
      }
    }

    for (const pointCloud of pointClouds) {
      pointCloud.material.setClipBoxes(clipBoxes);
    }
  }

  function addClipPlaneEntry(
    options: Partial<Pick<ClipPlaneEntry, "axis" | "offset" | "enabled">> = {},
  ) {
    const axis = options.axis ?? "X";
    const plane = new Plane();
    setPlaneNormal(plane, axis);
    const helper = new PlaneHelper(plane, helperSize, clipPlaneColors[axis]);
    helper.raycast = () => false;
    const entry: ClipPlaneEntry = {
      id: nextClipPlaneId++,
      axis,
      offset: options.offset ?? 0,
      enabled: options.enabled ?? true,
      plane,
      helper,
    };
    clipPlaneEntries.push(entry);
    scene.add(helper);
  }

  function removeClipPlaneEntry(id: number) {
    const index = clipPlaneEntries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const [entry] = clipPlaneEntries.splice(index, 1);
    scene.remove(entry.helper);
    renderClipPlaneFolder();
    updateClipPlanes();
    markPresetCustom();
  }

  function addClipBoxEntry(
    options: Partial<
      Pick<
        ClipBoxEntry,
        "offsetX" | "offsetY" | "offsetZ" | "scale" | "enabled"
      >
    > = {},
  ) {
    const helper = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: 0x0066ff, wireframe: true }),
    );
    helper.raycast = () => false;
    const entry: ClipBoxEntry = {
      id: nextClipBoxId++,
      offsetX: options.offsetX ?? 0,
      offsetY: options.offsetY ?? 0,
      offsetZ: options.offsetZ ?? 0,
      scale: options.scale ?? 1,
      enabled: options.enabled ?? true,
      helper,
    };
    clipBoxEntries.push(entry);
    scene.add(helper);
  }

  function removeClipBoxEntry(id: number) {
    const index = clipBoxEntries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const [entry] = clipBoxEntries.splice(index, 1);
    scene.remove(entry.helper);
    renderClipBoxFolder();
    updateClipBoxes();
    markPresetCustom();
  }

  let renderClipPlaneFolder = () => {};

  let renderClipBoxFolder = () => {};

  function getClipPlanePresetEntries(): ClipPlanePresetEntry[] {
    return clipPlaneEntries.map((entry) => ({
      axis: entry.axis,
      enabled: entry.enabled,
      offset: entry.offset,
    }));
  }

  function getClipBoxPresetEntries(): ClipBoxPresetEntry[] {
    return clipBoxEntries.map((entry) => ({
      enabled: entry.enabled,
      offsetX: entry.offsetX,
      offsetY: entry.offsetY,
      offsetZ: entry.offsetZ,
      scale: entry.scale,
    }));
  }

  function replaceClipPlaneEntries(entries: ClipPlanePresetEntry[]) {
    for (const entry of clipPlaneEntries.splice(0)) {
      scene.remove(entry.helper);
    }

    for (const entry of entries) {
      addClipPlaneEntry(entry);
    }

    renderClipPlaneFolder();
    updateClipPlanes();
  }

  function replaceClipBoxEntries(entries: ClipBoxPresetEntry[]) {
    for (const entry of clipBoxEntries.splice(0)) {
      scene.remove(entry.helper);
    }

    for (const entry of entries) {
      addClipBoxEntry(entry);
    }

    renderClipBoxFolder();
    updateClipBoxes();
  }

  // ClipMode
  const clipModeMap: Record<string, ClipMode> = {
    Disabled: ClipMode.DISABLED,
    "Highlight Inside": ClipMode.HIGHLIGHT_INSIDE,
    "Clip Outside": ClipMode.CLIP_OUTSIDE,
    "Clip Inside": ClipMode.CLIP_INSIDE,
  };
  const pointSizeTypeMap: Record<string, PointSizeType> = {
    Fixed: PointSizeType.FIXED,
    Attenuated: PointSizeType.ATTENUATED,
    Adaptive: PointSizeType.ADAPTIVE,
  };
  const pointShapeMap: Record<string, PointShape> = {
    Square: PointShape.SQUARE,
    Circle: PointShape.CIRCLE,
    Paraboloid: PointShape.PARABOLOID,
  };
  const pointColorTypeMap: Record<string, PointColorType> = {
    RGB: PointColorType.RGB,
    Height: PointColorType.HEIGHT,
    Intensity: PointColorType.INTENSITY,
    Classification: PointColorType.CLASSIFICATION,
    LOD: PointColorType.LOD,
    Source: PointColorType.SOURCE,
    Normal: PointColorType.NORMAL,
    Composite: PointColorType.COMPOSITE,
  };
  let localFileInput: HTMLInputElement | null = null;
  const BENCHMARK_PRESET_1_KEY = "potree-core.playground.benchmarkPreset1";
  let gui: GUI | null = null;
  let isApplyingPreset = false;

  // State
  const params = {
    pointBudgetMP: 1,
    maxNodesLoading: 4,
    // Camera
    orthographic: false,
    // EDL
    edlEnabled: false,
    edlStrength: 0.4,
    edlRadius: 1.4,
    edlOpacity: 1.0,
    edlNeighbours: 8,
    // Clipping
    clipMode: "Disabled",
    // Points
    pointSize: 0.1,
    minPointSize: 2.0,
    maxPointSize: 50.0,
    minNodePixelSize: 50,
    screenSpaceDensityLODEnabled: false,
    maxPointsPerPixel: 1.0,
    sizeType: "Adaptive",
    pointShape: "Square",
    pointColorType: "RGB",
    showBoundingBox: false,
    // Transform
    transformMode: "translate",
    // Pick
    pickMethod: "Potree",
    // Benchmark preset
    activePreset: "custom",
    savePreset1: () => {
      saveBenchmarkPreset("preset-1");
    },
    loadPreset1: () => {
      loadBenchmarkPreset("preset-1");
    },
    // Local dataset
    localDatasetStatus: "初期データセットを表示中です。",
    loadLocalDataset: () => {
      localFileInput?.click();
    },
  };
  params.pointBudgetMP = Math.max(
    1,
    Math.round(potree.pointBudget / 1_000_000),
  );
  params.maxNodesLoading = potree.maxNumNodesLoading;
  let localDatasetStatusController: { updateDisplay(): unknown } | null = null;

  function setLocalDatasetStatus(status: string) {
    params.localDatasetStatus = status;
    localDatasetStatusController?.updateDisplay();
  }

  // EDL
  const potreeRenderer = new PotreeRenderer({
    edl: {
      enabled: false,
      pointCloudLayer: 1,
      strength: params.edlStrength,
      radius: params.edlRadius,
      opacity: 1.0,
    },
  });

  // world
  const scene = new Scene();

  let useOrthographicCamera = false;
  const perspectiveCamera = new PerspectiveCamera(60, 1, 0.1, 1000);
  perspectiveCamera.position.set(-10, 10, 15);

  const orthographicFrustrumSize = 20;
  const orthographicCamera = new OrthographicCamera(
    -orthographicFrustrumSize / 2,
    orthographicFrustrumSize / 2,
    orthographicFrustrumSize / 2,
    -orthographicFrustrumSize / 2,
    0.1,
    1000,
  );
  orthographicCamera.position.set(0, 0, 10);
  let camera = perspectiveCamera as PerspectiveCamera | OrthographicCamera;

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.top = "0px";
  canvas.style.left = "0px";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  document.body.appendChild(canvas);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = ".json,.bin";
  fileInput.className = "local-loader-input";
  document.body.appendChild(fileInput);
  localFileInput = fileInput;

  fileInput.addEventListener("change", () => {
    const files = fileInput.files;

    if (files === null || files.length === 0) {
      return;
    }

    if (!LocalPotreeRequestManager.hasRequiredFiles(files)) {
      setLocalDatasetStatus(
        "metadata.json, hierarchy.bin, octree.bin の 3 ファイルを同時に選択してください。",
      );
      return;
    }

    setLocalDatasetStatus("ローカル Potree ファイルを読み込み中です...");
    loadMetrics.reset();

    void loadPointCloudFromSource(
      () =>
        potree.loadPointCloud(
          "metadata.json",
          LocalPotreeRequestManager.fromFileList(files),
          { instrumentation: loadMetrics.instrumentation },
        ),
      {
        position: new Vector3(0, -1.5, 3),
        rotation: new Euler(-Math.PI / 2, 0, 0),
        scale: new Vector3(2, 2, 2),
        applyClipBox: true,
        applyClipPlanes: true,
      },
      {
        label: "ローカルファイル",
        onSuccess: () => {
          setLocalDatasetStatus(
            "ローカル Potree ファイルを読み込みました。以後のノード取得はローカルファイルから行います。",
          );
        },
        onError: (error) => {
          setLocalDatasetStatus(
            `ローカル読込に失敗しました: ${formatError(error)}`,
          );
        },
      },
    );
  });

  const renderer = new WebGLRenderer({
    canvas: canvas,
    alpha: true,
    logarithmicDepthBuffer: true,
    precision: "highp",
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  const gpuTimer = createGpuTimer(renderer);

  const stats = new Stats();
  stats.showPanel(0);
  stats.dom.className = "playground-stats";
  stats.dom.style.position = "fixed";
  stats.dom.style.right = "16px";
  stats.dom.style.bottom = "16px";
  stats.dom.style.left = "auto";
  stats.dom.style.top = "auto";
  document.body.appendChild(stats.dom);

  const performancePanel = createPerformancePanel();
  document.body.appendChild(performancePanel.dom);

  function updatePerformancePanelPreset() {
    performancePanel.setPreset(params.activePreset);
  }

  function applyPointCloudSettings(pointCloud: PointCloudOctree) {
    pointCloud.material.size = params.pointSize;
    pointCloud.material.minSize = params.minPointSize;
    pointCloud.material.maxSize = params.maxPointSize;
    pointCloud.material.pointSizeType =
      pointSizeTypeMap[params.sizeType] ?? PointSizeType.ADAPTIVE;
    pointCloud.material.shape =
      pointShapeMap[params.pointShape] ?? PointShape.SQUARE;
    pointCloud.material.pointColorType =
      pointColorTypeMap[params.pointColorType] ?? PointColorType.RGB;
    pointCloud.material.clipMode = clipModeMap[params.clipMode];
    pointCloud.material.inputColorEncoding = 1;
    pointCloud.material.outputColorEncoding = 1;
    pointCloud.minNodePixelSize = params.minNodePixelSize;
    pointCloud.screenSpaceDensityLODEnabled =
      params.screenSpaceDensityLODEnabled;
    pointCloud.maxPointsPerPixel = params.maxPointsPerPixel;
    pointCloud.showBoundingBox = params.showBoundingBox;
  }

  function applySettingsToAllPointClouds() {
    for (const pointCloud of pointClouds) {
      applyPointCloudSettings(pointCloud);
    }
  }

  const cube = new Mesh(
    new BoxGeometry(25, 1, 25),
    new MeshBasicMaterial({ color: 0x44aa44 }),
  );
  cube.position.y = -2;
  scene.add(cube);
  scene.add(new AmbientLight(0xffffff));

  updateClipBoxes();
  updateClipPlanes();

  // ---- ViewHelper ----
  let viewHelper = new ViewHelper(camera, canvas);
  const timer = new Timer();
  timer.connect(document);

  let controls = new OrbitControls(camera, canvas);

  let transformControls = new TransformControls(camera, canvas);
  let transformControlsHelper = transformControls.getHelper();
  transformControls.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value;
  });
  scene.add(transformControlsHelper);

  const raycaster = new Raycaster();
  // @ts-ignore
  raycaster.params.Points.threshold = 1e-2;
  const normalized = new Vector2();

  canvas.onmousemove = (event) => {
    normalized.set(
      (event.clientX / canvas.width) * 2 - 1,
      -(event.clientY / canvas.height) * 2 + 1,
    );
    raycaster.setFromCamera(normalized, camera);
  };

  let selectedPco: PointCloudOctree | null = null;

  canvas.ondblclick = (event) => {
    const ray = raycaster.ray;
    const potreePick = pickPointClouds(pointClouds, renderer, camera, ray);
    const intersects = raycaster.intersectObjects(pointClouds, true);
    let pickedPco: PointCloudOctree | null = null;

    if (params.pickMethod === "Potree") {
      pickedPco = potreePick?.pointCloud ?? null;
    } else {
      if (intersects.length > 0) {
        let node = intersects[0].object;
        while (node != null) {
          if (pointClouds.includes(node as PointCloudOctree)) {
            pickedPco = node as PointCloudOctree;
            break;
          }
          node = node.parent as typeof node;
        }
      }
    }

    if (pickedPco) {
      selectedPco = pickedPco;
      transformControls.attach(selectedPco);
    } else {
      selectedPco = null;
      transformControls.detach();
    }

    const potreePosition = potreePick?.position;
    const raycasterPosition = intersects[0]?.point;
    const pickDelta =
      potreePosition && raycasterPosition
        ? potreePosition.distanceTo(raycasterPosition)
        : null;

    const clickScreen = new Vector2(event.clientX, event.clientY);
    const potreeScreen = potreePosition
      ? toScreenPosition(potreePosition, camera, renderer)
      : null;
    const raycasterScreen = raycasterPosition
      ? toScreenPosition(raycasterPosition, camera, renderer)
      : null;
    const potreeScreenDelta = potreeScreen
      ? clickScreen.distanceTo(potreeScreen)
      : null;
    const raycasterScreenDelta = raycasterScreen
      ? clickScreen.distanceTo(raycasterScreen)
      : null;

    console.log("pick comparison", {
      pickMethod: params.pickMethod,
      clickScreen: clickScreen.toArray(),
      potreePointCloud: potreePick?.pointCloud?.name ?? null,
      potreePosition: potreePosition?.toArray() ?? null,
      potreeScreen: potreeScreen?.toArray() ?? null,
      potreeScreenDelta,
      raycasterPosition: raycasterPosition?.toArray() ?? null,
      raycasterScreen: raycasterScreen?.toArray() ?? null,
      raycasterScreenDelta,
      delta: pickDelta,
      rayOrigin: ray.origin.toArray(),
      rayDirection: ray.direction.toArray(),
    });

    if (intersects.length > 0) {
      const sphere = new Mesh(
        new SphereGeometry(0.2, 32, 32),
        new MeshBasicMaterial({ color: Math.random() * 0xaa4444 }),
      );
      sphere.position.copy(intersects[0].point);
      scene.add(sphere);
    }
  };

  function toScreenPosition(
    worldPosition: Vector3,
    camera: PerspectiveCamera | OrthographicCamera,
    renderer: WebGLRenderer,
  ) {
    const projected = worldPosition.clone().project(camera);
    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;

    return new Vector2(
      (projected.x + 1) * width * 0.5,
      (1 - projected.y) * height * 0.5,
    );
  }

  // Load point cloud: pump
  loadMetrics.reset();
  void loadPointCloudFromSource(
    () =>
      potree.loadPointCloud("metadata.json", "/data/pump/", {
        instrumentation: loadMetrics.instrumentation,
      }),
    {
      position: new Vector3(0, -1.5, 3),
      rotation: new Euler(-Math.PI / 2, 0, 0),
      scale: new Vector3(2, 2, 2),
      applyClipBox: true,
      applyClipPlanes: true,
    },
    {
      label: "サンプルデータセット",
      onSuccess: () => {
        setLocalDatasetStatus(
          "初期データセットを表示中です。ローカル読込で差し替えできます。",
        );
      },
      onError: (error) => {
        setLocalDatasetStatus(
          `初期データセットの読込に失敗しました: ${formatError(error)}`,
        );
      },
    },
  );

  function clearPointCloudScene() {
    transformControls.detach();
    selectedPco = null;
    clipBoxesActive = false;
    clipPlanesActive = false;
    pointClouds.splice(0).forEach((pointCloud) => {
      scene.remove(pointCloud);
      pointCloud.dispose();
    });

    if (clipSphereHelperMesh !== null) {
      scene.remove(clipSphereHelperMesh);
      clipSphereHelperMesh = null;
    }

    updateClipBoxes();
    updateClipPlanes();
  }

  async function loadPointCloudFromSource(
    load: () => Promise<LoadedPointCloud>,
    options: {
      position?: Vector3;
      rotation?: Euler;
      scale?: Vector3;
      applyClipBox?: boolean;
      applyClipSphere?: boolean;
      applyClipPlanes?: boolean;
    },
    hooks: {
      label: string;
      onSuccess?: () => void;
      onError?: (error: unknown) => void;
    },
  ) {
    try {
      const pointCloud = await load();
      const pco = createPointCloudOctree(potree, pointCloud);
      clearPointCloudScene();
      applyPointCloudSettings(pco);

      if (options.position) {
        pco.position.copy(options.position);
      }
      if (options.rotation) {
        pco.rotation.copy(options.rotation);
      }
      if (options.scale) {
        pco.scale.copy(options.scale);
      }

      console.log(`${hooks.label} loaded`, pco);
      pco.showBoundingBox = false;

      pco.updateMatrixWorld(true);
      const worldBBox = toThreeBox3(pco.pcoGeometry.boundingBox).applyMatrix4(
        pco.matrixWorld,
      );
      const center = worldBBox.getCenter(new Vector3());
      const worldSize = worldBBox.getSize(new Vector3());

      pco.material.clipMode = clipModeMap[params.clipMode];

      clipBoxesActive = options.applyClipBox ?? false;
      clipPlanesActive = options.applyClipPlanes ?? false;

      if (clipBoxesActive) {
        clipBoxCenter.copy(center);
        clipBoxExtent.copy(worldSize).multiplyScalar(0.5);
        updateClipBoxes();
      } else {
        pco.material.setClipBoxes([]);
      }

      if (clipPlanesActive) {
        planeCenter.copy(center);
        planeExtent.copy(worldSize).multiplyScalar(0.5);
        updateClipPlanes();
      } else {
        pco.material.clippingPlanes = null;
      }

      if (options.applyClipSphere) {
        // ClipSphere
        const radius = worldSize.length() * 0.25;
        const clipSphere = createClipSphere(center, radius);
        pco.material.clipMode = clipModeMap[params.clipMode];
        pco.material.setClipSpheres([clipSphere]);

        clipSphereHelperMesh = new Mesh(
          new SphereGeometry(radius, 16, 16),
          new MeshBasicMaterial({ color: 0xff6600, wireframe: true }),
        );
        clipSphereHelperMesh.position.copy(center);
        clipSphereHelperMesh.raycast = () => false;
        scene.add(clipSphereHelperMesh);
      }

      scene.add(pco);
      pointClouds.push(pco);
      hooks.onSuccess?.();
    } catch (error) {
      console.error(`${hooks.label} load failed`, error);
      hooks.onError?.(error);
    }
  }

  function formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  // ---- Camera switch ----
  function switchCamera(toOrthographic: boolean) {
    if (toOrthographic === useOrthographicCamera) return;
    useOrthographicCamera = toOrthographic;

    const current = toOrthographic ? perspectiveCamera : orthographicCamera;
    const target = toOrthographic ? orthographicCamera : perspectiveCamera;
    target.position.copy(current.position);
    target.quaternion.copy(current.quaternion);
    camera = target;

    controls.dispose();
    controls = new OrbitControls(camera, canvas);
    controls.addEventListener("change", markPresetCustom);

    const wasAttached = transformControls.object;
    scene.remove(transformControlsHelper);
    transformControls.dispose();
    transformControls = new TransformControls(camera, canvas);
    transformControlsHelper = transformControls.getHelper();
    transformControls.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
    });
    scene.add(transformControlsHelper);
    if (wasAttached) transformControls.attach(wasAttached);

    viewHelper = new ViewHelper(camera, canvas);

    updateSize();
  }

  function markPresetCustom() {
    if (isApplyingPreset) {
      return;
    }

    if (params.activePreset !== "custom") {
      params.activePreset = "custom";
      updatePerformancePanelPreset();
      updateGuiDisplays();
    }
  }

  function updateGuiDisplays() {
    if (gui === null) {
      return;
    }

    for (const controller of gui.controllersRecursive()) {
      controller.updateDisplay();
    }
  }

  function createBenchmarkPreset(name: string): BenchmarkPreset {
    return {
      camera: {
        far: camera.far,
        fov:
          camera instanceof PerspectiveCamera
            ? camera.fov
            : perspectiveCamera.fov,
        near: camera.near,
        orthographic: useOrthographicCamera,
        orthographicZoom:
          camera instanceof OrthographicCamera
            ? camera.zoom
            : orthographicCamera.zoom,
        position: camera.position.toArray(),
        target: controls.target.toArray(),
      },
      clipping: {
        boxes: getClipBoxPresetEntries(),
        planes: getClipPlanePresetEntries(),
        showBoxHelpers: clippingUiState.showBoxHelpers,
        showPlaneHelpers: clippingUiState.showPlaneHelpers,
      },
      clipMode: params.clipMode,
      edl: {
        enabled: params.edlEnabled,
        neighbours: params.edlNeighbours,
        opacity: params.edlOpacity,
        radius: params.edlRadius,
        strength: params.edlStrength,
      },
      name,
      performance: {
        maxNodesLoading: params.maxNodesLoading,
        pointBudgetMP: params.pointBudgetMP,
      },
      points: {
        maxPointSize: params.maxPointSize,
        maxPointsPerPixel: params.maxPointsPerPixel,
        minNodePixelSize: params.minNodePixelSize,
        minPointSize: params.minPointSize,
        pointColorType: params.pointColorType,
        pointShape: params.pointShape,
        pointSize: params.pointSize,
        screenSpaceDensityLODEnabled: params.screenSpaceDensityLODEnabled,
        showBoundingBox: params.showBoundingBox,
        sizeType: params.sizeType,
      },
      savedAt: new Date().toISOString(),
      version: 2,
    };
  }

  function saveBenchmarkPreset(name: string) {
    const preset = createBenchmarkPreset(name);
    localStorage.setItem(BENCHMARK_PRESET_1_KEY, JSON.stringify(preset));
    params.activePreset = name;
    updatePerformancePanelPreset();
    updateGuiDisplays();
  }

  function loadBenchmarkPreset(name: string) {
    const rawPreset = localStorage.getItem(BENCHMARK_PRESET_1_KEY);
    if (rawPreset === null) {
      console.warn(`Benchmark preset ${name} is not saved yet.`);
      return;
    }

    const preset = JSON.parse(rawPreset) as BenchmarkPreset;
    isApplyingPreset = true;
    try {
      applyBenchmarkPreset(preset);
      params.activePreset = preset.name;
      updatePerformancePanelPreset();
      updateGuiDisplays();
    } finally {
      isApplyingPreset = false;
    }
  }

  function applyBenchmarkPreset(preset: BenchmarkPreset) {
    params.pointBudgetMP = preset.performance.pointBudgetMP;
    params.maxNodesLoading = preset.performance.maxNodesLoading;
    potree.pointBudget = Math.round(params.pointBudgetMP) * 1_000_000;
    potree.maxNumNodesLoading = Math.round(params.maxNodesLoading);

    params.orthographic = preset.camera.orthographic;
    switchCamera(preset.camera.orthographic);
    camera.near = preset.camera.near;
    camera.far = preset.camera.far;
    if (camera instanceof PerspectiveCamera) {
      camera.fov = preset.camera.fov;
    }
    if (camera instanceof OrthographicCamera) {
      camera.zoom = preset.camera.orthographicZoom;
    }
    camera.position.fromArray(preset.camera.position);
    controls.target.fromArray(preset.camera.target);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    controls.update();

    params.edlEnabled = preset.edl.enabled;
    params.edlStrength = preset.edl.strength;
    params.edlRadius = preset.edl.radius;
    params.edlOpacity = preset.edl.opacity;
    params.edlNeighbours = preset.edl.neighbours;
    potreeRenderer.setEDL({
      enabled: params.edlEnabled,
      neighbourCount: params.edlNeighbours,
      opacity: params.edlOpacity,
      radius: params.edlRadius,
      strength: params.edlStrength,
    });

    params.clipMode = preset.clipMode;
    if (preset.clipping) {
      clippingUiState.showBoxHelpers = preset.clipping.showBoxHelpers;
      clippingUiState.showPlaneHelpers = preset.clipping.showPlaneHelpers;
      replaceClipBoxEntries(preset.clipping.boxes);
      replaceClipPlaneEntries(preset.clipping.planes);
    }
    params.pointSize = preset.points.pointSize;
    params.minPointSize = preset.points.minPointSize;
    params.maxPointSize = preset.points.maxPointSize;
    params.minNodePixelSize = preset.points.minNodePixelSize ?? 50;
    params.screenSpaceDensityLODEnabled =
      preset.points.screenSpaceDensityLODEnabled ?? false;
    params.maxPointsPerPixel = preset.points.maxPointsPerPixel ?? 1.0;
    params.sizeType = preset.points.sizeType;
    params.pointShape = preset.points.pointShape;
    params.pointColorType = preset.points.pointColorType;
    params.showBoundingBox = preset.points.showBoundingBox;
    applySettingsToAllPointClouds();
  }

  // ---- gui ----
  gui = new GUI({ title: "Playground Controls" });
  controls.addEventListener("change", markPresetCustom);

  const localDatasetFolder = gui.addFolder("Local Dataset");
  localDatasetFolder
    .add(params, "loadLocalDataset")
    .name("ローカルファイルを選択");
  localDatasetStatusController = localDatasetFolder
    .add(params, "localDatasetStatus")
    .name("Status")
    .listen()
    .disable();

  const performanceFolder = gui.addFolder("Performance");
  performanceFolder
    .add(params, "pointBudgetMP", 1, 50, 1)
    .name("Point Budget (MP)")
    .onChange((value: number) => {
      potree.pointBudget = Math.round(value) * 1_000_000;
      markPresetCustom();
    });
  performanceFolder
    .add(params, "maxNodesLoading", 1, 12, 1)
    .name("Max Nodes Loading")
    .onChange((value: number) => {
      potree.maxNumNodesLoading = Math.round(value);
      markPresetCustom();
    });
  performanceFolder
    .add(params, "activePreset")
    .name("Active Preset")
    .listen()
    .disable();
  performanceFolder.add(params, "savePreset1").name("Save Preset 1");
  performanceFolder.add(params, "loadPreset1").name("Load Preset 1");

  // Camera folder
  const cameraFolder = gui.addFolder("Camera");
  cameraFolder
    .add(params, "orthographic")
    .name("Orthographic")
    .onChange((v: boolean) => {
      switchCamera(v);
      markPresetCustom();
    });
  cameraFolder.close();

  // EDL folder
  const edlFolder = gui.addFolder("EDL");
  edlFolder
    .add(params, "edlEnabled")
    .name("Enabled")
    .onChange((v: boolean) => {
      potreeRenderer.setEDL({ enabled: v });
      markPresetCustom();
    });
  edlFolder
    .add(params, "edlStrength", 0, 5, 0.1)
    .name("Strength")
    .onChange((v: number) => {
      potreeRenderer.setEDL({ enabled: params.edlEnabled, strength: v });
      markPresetCustom();
    });
  edlFolder
    .add(params, "edlRadius", 0, 5, 0.1)
    .name("Radius")
    .onChange((v: number) => {
      potreeRenderer.setEDL({ enabled: params.edlEnabled, radius: v });
      markPresetCustom();
    });
  edlFolder
    .add(params, "edlOpacity", 0, 1, 0.05)
    .name("Opacity")
    .onChange((v: number) => {
      potreeRenderer.setEDL({ enabled: params.edlEnabled, opacity: v });
      markPresetCustom();
    });
  edlFolder
    .add(params, "edlNeighbours", 1, 16, 1)
    .name("Neighbours")
    .onChange((v: number) => {
      potreeRenderer.setEDL({ enabled: params.edlEnabled, neighbourCount: v });
      markPresetCustom();
    });
  edlFolder.close();

  // Clipping folder
  const clipFolder = gui.addFolder("Clipping");
  clipFolder
    .add(params, "clipMode", Object.keys(clipModeMap))
    .name("Clip Mode")
    .onChange((v: string) => {
      const mode = clipModeMap[v];
      for (const pco of pointClouds) pco.material.clipMode = mode;
      markPresetCustom();
    });
  clipFolder.close();

  renderClipBoxFolder = function renderClipBoxFolderImpl() {
    clipBoxFolder?.destroy();
    clipBoxFolder = clipFolder.addFolder("Clip Boxes");
    clipBoxFolder.add(clippingUiState, "addClipBox").name("Add Box");
    clipBoxFolder
      .add(clippingUiState, "showBoxHelpers")
      .name("Show Helpers")
      .onChange(() => {
        updateClipBoxes();
        markPresetCustom();
      });

    for (const entry of clipBoxEntries) {
      const entryFolder = clipBoxFolder.addFolder(`Box ${entry.id}`);
      entryFolder
        .add(entry, "enabled")
        .name("Enabled")
        .onChange(() => {
          updateClipBoxes();
          markPresetCustom();
        });
      entryFolder
        .add(entry, "offsetX", -1, 1, 0.01)
        .name("Offset X")
        .onChange(() => {
          updateClipBoxes();
          markPresetCustom();
        });
      entryFolder
        .add(entry, "offsetY", -1, 1, 0.01)
        .name("Offset Y")
        .onChange(() => {
          updateClipBoxes();
          markPresetCustom();
        });
      entryFolder
        .add(entry, "offsetZ", -1, 1, 0.01)
        .name("Offset Z")
        .onChange(() => {
          updateClipBoxes();
          markPresetCustom();
        });
      entryFolder
        .add(entry, "scale", 0.1, 2, 0.05)
        .name("Scale")
        .onChange(() => {
          updateClipBoxes();
          markPresetCustom();
        });
      entryFolder
        .add({ remove: () => removeClipBoxEntry(entry.id) }, "remove")
        .name("Remove");
    }
  };

  renderClipPlaneFolder = function renderClipPlaneFolderImpl() {
    clipPlaneFolder?.destroy();
    clipPlaneFolder = clipFolder.addFolder("Clip Planes");
    clipPlaneFolder.add(clippingUiState, "addClipPlane").name("Add Plane");
    clipPlaneFolder
      .add(clippingUiState, "showPlaneHelpers")
      .name("Show Helpers")
      .onChange(() => {
        updateClipPlanes();
        markPresetCustom();
      });

    for (const entry of clipPlaneEntries) {
      const entryFolder = clipPlaneFolder.addFolder(`Plane ${entry.id}`);
      entryFolder
        .add(entry, "enabled")
        .name("Enabled")
        .onChange(() => {
          updateClipPlanes();
          markPresetCustom();
        });
      entryFolder
        .add(entry, "axis", ["X", "Y", "Z"])
        .name("Axis")
        .onChange(() => {
          updateClipPlanes();
          markPresetCustom();
        });
      entryFolder
        .add(entry, "offset", -1, 1, 0.01)
        .name("Offset")
        .onChange(() => {
          updateClipPlanes();
          markPresetCustom();
        });
      entryFolder
        .add({ remove: () => removeClipPlaneEntry(entry.id) }, "remove")
        .name("Remove");
    }
  };

  renderClipBoxFolder();
  renderClipPlaneFolder();

  // Points folder
  const pointsFolder = gui.addFolder("Points");
  pointsFolder
    .add(params, "pointSize", 0.1, 5, 0.1)
    .name("Size")
    .onChange((v: number) => {
      for (const pco of pointClouds) pco.material.size = v;
      markPresetCustom();
    });
  pointsFolder
    .add(params, "minPointSize", 1, 10, 0.5)
    .name("Min Size")
    .onChange((v: number) => {
      for (const pco of pointClouds) pco.material.minSize = v;
      markPresetCustom();
    });
  pointsFolder
    .add(params, "maxPointSize", 5, 100, 1)
    .name("Max Size")
    .onChange((v: number) => {
      for (const pco of pointClouds) pco.material.maxSize = v;
      markPresetCustom();
    });
  pointsFolder
    .add(params, "minNodePixelSize", 0, 500, 1)
    .name("Min Node Pixel Size")
    .onChange((v: number) => {
      for (const pco of pointClouds) pco.minNodePixelSize = v;
      markPresetCustom();
    });
  pointsFolder
    .add(params, "screenSpaceDensityLODEnabled")
    .name("Screen Density LOD")
    .onChange((v: boolean) => {
      for (const pco of pointClouds) pco.screenSpaceDensityLODEnabled = v;
      markPresetCustom();
    });
  pointsFolder
    .add(params, "maxPointsPerPixel", 0.1, 16, 0.1)
    .name("Max Points / Pixel")
    .onChange((v: number) => {
      for (const pco of pointClouds) pco.maxPointsPerPixel = v;
      markPresetCustom();
    });
  pointsFolder
    .add(params, "sizeType", ["Fixed", "Attenuated", "Adaptive"])
    .name("Size Type")
    .onChange((v: string) => {
      for (const pco of pointClouds) {
        pco.material.pointSizeType =
          pointSizeTypeMap[v] ?? PointSizeType.ADAPTIVE;
      }
      markPresetCustom();
    });
  pointsFolder
    .add(params, "pointShape", Object.keys(pointShapeMap))
    .name("Point Shape")
    .onChange((v: string) => {
      for (const pco of pointClouds) {
        pco.material.shape = pointShapeMap[v] ?? PointShape.SQUARE;
      }
      markPresetCustom();
    });
  pointsFolder
    .add(params, "pointColorType", Object.keys(pointColorTypeMap))
    .name("Color Type")
    .onChange((v: string) => {
      for (const pco of pointClouds) {
        pco.material.pointColorType =
          pointColorTypeMap[v] ?? PointColorType.RGB;
      }
      markPresetCustom();
    });
  pointsFolder
    .add(params, "showBoundingBox")
    .name("Bounding Box")
    .onChange((v: boolean) => {
      for (const pco of pointClouds) pco.showBoundingBox = v;
      markPresetCustom();
    });

  // Interaction folder
  const interactionFolder = gui.addFolder("Interaction");
  interactionFolder
    .add(params, "transformMode", ["translate", "rotate", "scale"])
    .name("Transform")
    .onChange((v: string) => {
      transformControls.setMode(v as "translate" | "rotate" | "scale");
    });
  interactionFolder
    .add(params, "pickMethod", ["Potree", "Raycaster"])
    .name("Pick Method");
  interactionFolder.close();

  // ---- Render loop ----
  renderer.autoClear = false;

  renderer.setAnimationLoop(() => {
    const frameStart = performance.now();
    timer.update();
    stats.begin();

    const updateStart = performance.now();
    const visibilityResult = updatePointClouds(
      potree,
      pointClouds,
      camera,
      renderer,
    );
    const updateMs = performance.now() - updateStart;

    controls.update();

    // autoClear is disabled to allow ViewHelper to overlay on top of the scene.
    // As a result, we must clear manually at the start of each frame.
    renderer.clear();

    const previousInfoAutoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();

    const renderStart = performance.now();
    const gpuTimerStarted = gpuTimer.begin();
    try {
      if (!params.edlEnabled) {
        renderer.render(scene, camera);
      } else {
        potreeRenderer.render({ renderer, scene, camera, pointClouds });
      }
    } finally {
      if (gpuTimerStarted) {
        gpuTimer.end();
      }
    }
    const renderMs = performance.now() - renderStart;
    const renderInfo = snapshotRendererInfo(renderer);
    renderer.info.autoReset = previousInfoAutoReset;

    // Render ViewHelper
    viewHelper.render(renderer);
    if (viewHelper.animating) viewHelper.update(timer.getDelta());
    stats.end();
    performancePanel.update({
      camera,
      edlEnabled: params.edlEnabled,
      frameMs: performance.now() - frameStart,
      gpuTiming: gpuTimer.snapshot(),
      loadMetrics: loadMetrics.snapshot(),
      pointClouds,
      renderer,
      renderInfo,
      renderMs,
      pointSize: params.pointSize,
      minPointSize: params.minPointSize,
      maxPointSize: params.maxPointSize,
      sizeType: params.sizeType,
      updateMs,
      visibilityResult,
    });
  });

  function updateSize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);

    if (useOrthographicCamera) {
      const aspect = width / height;
      orthographicCamera.left = (-orthographicFrustrumSize * aspect) / 2;
      orthographicCamera.right = (orthographicFrustrumSize * aspect) / 2;
      orthographicCamera.top = orthographicFrustrumSize / 2;
      orthographicCamera.bottom = -orthographicFrustrumSize / 2;
      orthographicCamera.updateProjectionMatrix();
    } else {
      perspectiveCamera.aspect = width / height;
      perspectiveCamera.updateProjectionMatrix();
    }
  }

  document.body.onresize = () => {
    updateSize();
  };

  // @ts-ignore
  document.body.onresize();
};

interface PerformancePanelUpdate {
  camera: PerspectiveCamera | OrthographicCamera;
  edlEnabled: boolean;
  frameMs: number;
  gpuTiming: GpuTimingSnapshot;
  loadMetrics: LoadMetricsSnapshot;
  pointClouds: PointCloudOctree[];
  renderer: WebGLRenderer;
  renderInfo: RenderInfoSnapshot;
  renderMs: number;
  pointSize: number;
  minPointSize: number;
  maxPointSize: number;
  sizeType: string;
  updateMs: number;
  visibilityResult: IVisibilityUpdateResult;
}

interface RenderInfoSnapshot {
  memory: {
    geometries: number;
    textures: number;
  };
  render: {
    calls: number;
    points: number;
    triangles: number;
  };
}

interface GpuTimingSnapshot {
  averageMs: number | null;
  lastMs: number | null;
  pending: number;
  status: string;
  supported: boolean;
}

type PerformanceRowKey =
  | "fps"
  | "activePreset"
  | "sizeType"
  | "pointSize"
  | "minPointSize"
  | "maxPointSize"
  | "sampleWindow"
  | "rafMs"
  | "cpuWorkMs"
  | "waitMs"
  | "loadStatus"
  | "camera"
  | "cameraPosition"
  | "canvas"
  | "pixelRatio"
  | "jsHeap"
  | "updateMs"
  | "visiblePoints"
  | "visibleNodes"
  | "visibleGeometry"
  | "densityLOD"
  | "densityCulledNodes"
  | "densityCulledPoints"
  | "nodeLoads"
  | "loadingNodes"
  | "pointBudget"
  | "pointBudgetUse"
  | "lruPoints"
  | "lruNodes"
  | "lruBudgetUse"
  | "octreeReadMs"
  | "hierarchyLoadMs"
  | "hierarchyParseMs"
  | "networkBytes"
  | "networkEvents"
  | "bytesPerFetch"
  | "octreeNodesPerFetch"
  | "octreeCacheHitRate"
  | "octreeFetchRatio"
  | "networkThroughput"
  | "workerWaitMs"
  | "decompressMs"
  | "attributeDecodeMs"
  | "decodeMs"
  | "transferMs"
  | "geometryMs"
  | "decodedPoints"
  | "decodeThroughput"
  | "rawBufferBytes"
  | "generatedBufferBytes"
  | "preciseBufferBytes"
  | "transferBufferBytes"
  | "generatedBytesPerPoint"
  | "renderMs"
  | "gpuTimeMs"
  | "gpuTimeLastMs"
  | "gpuTimerStatus"
  | "submittedPoints"
  | "drawCalls"
  | "renderPoints"
  | "renderTriangles"
  | "gpuGeometries"
  | "gpuTextures"
  | "edl";

interface LoadStageSummary {
  count: number;
  cacheHitCount: number;
  totalBytes: number;
  totalFetchedBytes: number;
  totalFetchCount: number;
  totalGeneratedBufferBytes: number;
  totalPreciseBufferBytes: number;
  totalRawBufferBytes: number;
  totalTransferBufferBytes: number;
  totalMs: number;
  totalPoints: number;
}

type LoadMetricsSnapshot = Record<PotreeLoadStage, LoadStageSummary>;

interface BenchmarkPreset {
  camera: {
    far: number;
    fov: number;
    near: number;
    orthographic: boolean;
    orthographicZoom: number;
    position: number[];
    target: number[];
  };
  clipping?: {
    boxes: Array<{
      enabled: boolean;
      offsetX: number;
      offsetY: number;
      offsetZ: number;
      scale: number;
    }>;
    planes: Array<{
      axis: "X" | "Y" | "Z";
      enabled: boolean;
      offset: number;
    }>;
    showBoxHelpers: boolean;
    showPlaneHelpers: boolean;
  };
  clipMode: string;
  edl: {
    enabled: boolean;
    neighbours: number;
    opacity: number;
    radius: number;
    strength: number;
  };
  name: string;
  performance: {
    maxNodesLoading: number;
    pointBudgetMP: number;
  };
  points: {
    maxPointSize: number;
    maxPointsPerPixel?: number;
    minNodePixelSize?: number;
    minPointSize: number;
    pointColorType: string;
    pointShape: string;
    pointSize: number;
    screenSpaceDensityLODEnabled?: boolean;
    showBoundingBox: boolean;
    sizeType: string;
  };
  savedAt: string;
  version: 1 | 2;
}

interface FrameStatSample {
  cpuWorkMs: number;
  gpuMs: number | null;
  rafMs: number;
  renderMs: number;
  updateMs: number;
  waitMs: number;
}

interface MetricSummary {
  avg: number;
  max: number;
  p95: number;
}

interface FrameStatSummary {
  count: number;
  cpuWorkMs: MetricSummary;
  gpuMs: MetricSummary | null;
  rafMs: MetricSummary;
  renderMs: MetricSummary;
  updateMs: MetricSummary;
  waitMs: MetricSummary;
}

function createPerformancePanel() {
  const sections = [
    {
      title: "Overall",
      open: true,
      rows: [
        ["fps", "FPS avg"],
        ["activePreset", "Preset"],
        ["sizeType", "Size Type"],
        ["pointSize", "Point size"],
        ["minPointSize", "Min point size"],
        ["maxPointSize", "Max point size"],
        ["sampleWindow", "Sample window"],
        ["rafMs", "rAF interval"],
        ["cpuWorkMs", "CPU work"],
        ["waitMs", "Wait / GPU"],
        ["loadStatus", "Load status"],
        ["camera", "Camera"],
        ["cameraPosition", "Camera pos"],
        ["canvas", "Canvas"],
        ["pixelRatio", "Pixel ratio"],
        ["jsHeap", "JS heap"],
      ],
    },
    {
      title: "LOD / Visibility",
      open: true,
      rows: [
        ["updateMs", "Update"],
        ["visiblePoints", "Visible points"],
        ["visibleNodes", "Visible nodes"],
        ["visibleGeometry", "Visible geometry"],
        ["densityLOD", "Density LOD"],
        ["densityCulledNodes", "Density culled nodes"],
        ["densityCulledPoints", "Density culled points"],
        ["nodeLoads", "Node load queue"],
        ["loadingNodes", "Loading nodes"],
        ["pointBudget", "Point budget"],
        ["pointBudgetUse", "Budget use"],
        ["lruPoints", "LRU points"],
        ["lruNodes", "LRU nodes"],
        ["lruBudgetUse", "LRU / budget"],
      ],
    },
    {
      title: "Network / IO",
      open: true,
      rows: [
        ["octreeReadMs", "Octree read avg"],
        ["hierarchyLoadMs", "Hierarchy load avg"],
        ["hierarchyParseMs", "Hierarchy parse avg"],
        ["networkBytes", "Fetched bytes"],
        ["networkEvents", "Fetch events"],
        ["bytesPerFetch", "Bytes / fetch"],
        ["octreeNodesPerFetch", "Octree nodes / fetch"],
        ["octreeCacheHitRate", "Octree cache hit"],
        ["octreeFetchRatio", "Octree fetched / node bytes"],
        ["networkThroughput", "Fetch throughput"],
      ],
    },
    {
      title: "Decode / CPU",
      open: true,
      rows: [
        ["workerWaitMs", "Worker wait avg"],
        ["decompressMs", "Decompress avg"],
        ["attributeDecodeMs", "Attribute decode avg"],
        ["decodeMs", "Decode avg"],
        ["transferMs", "Transfer avg"],
        ["geometryMs", "Geometry avg"],
        ["decodedPoints", "Decoded points"],
        ["decodeThroughput", "Decode throughput"],
        ["rawBufferBytes", "Raw buffer bytes"],
        ["generatedBufferBytes", "Generated buffer bytes"],
        ["preciseBufferBytes", "Precise buffer bytes"],
        ["transferBufferBytes", "Transfer buffer bytes"],
        ["generatedBytesPerPoint", "Generated bytes / point"],
      ],
    },
    {
      title: "GPU / Render",
      open: true,
      rows: [
        ["renderMs", "CPU render submit"],
        ["gpuTimeMs", "GPU time avg"],
        ["gpuTimeLastMs", "GPU time last"],
        ["gpuTimerStatus", "GPU timer"],
        ["submittedPoints", "Submitted points est"],
        ["drawCalls", "Draw calls"],
        ["renderPoints", "Three.js points"],
        ["renderTriangles", "Triangles"],
        ["gpuGeometries", "GPU geometries"],
        ["gpuTextures", "GPU textures"],
        ["edl", "EDL"],
      ],
    },
  ] as const;

  const dom = document.createElement("section");
  dom.className = "performance-panel";
  dom.setAttribute("aria-label", "Performance metrics");

  const header = document.createElement("div");
  header.className = "performance-panel__header";
  dom.appendChild(header);

  const title = document.createElement("h2");
  title.textContent = "Performance";
  header.appendChild(title);

  const metricOrder = document.createElement("span");
  metricOrder.className = "performance-panel__metric-order";
  metricOrder.textContent = "avg / p95 / max";
  header.appendChild(metricOrder);

  const copyButton = document.createElement("button");
  copyButton.className = "performance-panel__copy";
  copyButton.type = "button";
  copyButton.textContent = "Copy";
  copyButton.title = "Copy performance metrics";
  copyButton.setAttribute("aria-label", "Copy performance metrics");
  header.appendChild(copyButton);

  const values = new Map<PerformanceRowKey, HTMLElement>();
  let activePreset = "custom";
  for (const section of sections) {
    const details = document.createElement("details");
    details.className = "performance-panel__section";
    details.open = section.open;

    const summary = document.createElement("summary");
    summary.textContent = section.title;
    details.appendChild(summary);

    const list = document.createElement("dl");
    details.appendChild(list);

    for (const [key, label] of section.rows) {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = "-";
      values.set(key, description);
      list.append(term, description);
    }

    dom.appendChild(details);
  }

  let lastPanelUpdate = 0;
  let lastFrameAt = performance.now();
  const frameStats = createFrameStats(120);

  copyButton.addEventListener("click", () => {
    void copyPanelText(buildPanelText());
  });

  function update(metrics: PerformancePanelUpdate) {
    const now = performance.now();
    const instantRafMs = Math.max(now - lastFrameAt, 0.001);
    lastFrameAt = now;
    const waitMs = Math.max(instantRafMs - metrics.frameMs, 0);
    frameStats.add({
      cpuWorkMs: metrics.frameMs,
      gpuMs: metrics.gpuTiming.lastMs,
      rafMs: instantRafMs,
      renderMs: metrics.renderMs,
      updateMs: metrics.updateMs,
      waitMs,
    });

    if (now - lastPanelUpdate < 250) {
      return;
    }
    lastPanelUpdate = now;
    const frameSummary = frameStats.summary();

    const { pointClouds, renderer, renderInfo, visibilityResult } = metrics;
    const rendererSize = renderer.getSize(new Vector2());
    const diagnostics = collectPointCloudDiagnostics(
      pointClouds[0]?.potree,
      pointClouds,
      visibilityResult,
    );
    const heap = getHeapUsage();
    const octreeRead = metrics.loadMetrics["octree-slice-read"];
    const hierarchyLoad = metrics.loadMetrics["hierarchy-load"];
    const hierarchyParse = metrics.loadMetrics["hierarchy-parse"];
    const workerWait = metrics.loadMetrics["worker-wait"];
    const decompress = metrics.loadMetrics.decompress;
    const attributeDecode = metrics.loadMetrics["attribute-decode"];
    const transfer = metrics.loadMetrics["worker-transfer"];
    const geometry = metrics.loadMetrics["geometry-creation"];
    const decodeMs = decompress.totalMs + attributeDecode.totalMs;
    const decodedPoints = attributeDecode.totalPoints;
    const generatedBufferBytes = attributeDecode.totalGeneratedBufferBytes;
    const preciseBufferBytes = attributeDecode.totalPreciseBufferBytes;
    const rawBufferBytes = attributeDecode.totalRawBufferBytes;
    const transferBufferBytes = transfer.totalTransferBufferBytes;
    const networkBytes =
      octreeRead.totalFetchedBytes + hierarchyLoad.totalFetchedBytes;
    const networkEvents =
      octreeRead.totalFetchCount + hierarchyLoad.totalFetchCount;
    const networkMs = octreeRead.totalMs + hierarchyLoad.totalMs;
    setValue("fps", formatNumber(1000 / frameSummary.rafMs.avg, 1));
    setValue("activePreset", activePreset);
    setValue("sizeType", metrics.sizeType);
    setValue("pointSize", formatNumber(metrics.pointSize, 2));
    setValue("minPointSize", formatNumber(metrics.minPointSize, 2));
    setValue("maxPointSize", formatNumber(metrics.maxPointSize, 2));
    setValue("sampleWindow", `${formatInteger(frameSummary.count)} frames`);
    setValue("rafMs", formatMetricMs(frameSummary.rafMs));
    setValue("cpuWorkMs", formatMetricMs(frameSummary.cpuWorkMs));
    setValue("waitMs", formatMetricMs(frameSummary.waitMs));
    setValue("updateMs", formatMetricMs(frameSummary.updateMs));
    setValue("renderMs", formatMetricMs(frameSummary.renderMs));
    setValue("gpuTimeMs", formatMetricMs(frameSummary.gpuMs));
    setValue("gpuTimeLastMs", formatOptionalMs(metrics.gpuTiming.lastMs));
    setValue(
      "gpuTimerStatus",
      `${metrics.gpuTiming.status}${
        metrics.gpuTiming.pending > 0 ? ` (${metrics.gpuTiming.pending})` : ""
      }`,
    );
    setValue(
      "submittedPoints",
      formatInteger(visibilityResult.numVisiblePoints),
    );
    setValue("drawCalls", formatInteger(renderInfo.render.calls));
    setValue("renderPoints", formatInteger(renderInfo.render.points));
    setValue("renderTriangles", formatInteger(renderInfo.render.triangles));
    setValue("visiblePoints", formatInteger(visibilityResult.numVisiblePoints));
    setValue(
      "visibleNodes",
      formatInteger(visibilityResult.visibleNodes.length),
    );
    setValue(
      "visibleGeometry",
      formatInteger(diagnostics.visibleGeometryCount),
    );
    const densityLODEnabled = metrics.pointClouds.some(
      (pointCloud) => pointCloud.screenSpaceDensityLODEnabled,
    );
    const maxPointsPerPixel = metrics.pointClouds.reduce(
      (max, pointCloud) => Math.max(max, pointCloud.maxPointsPerPixel),
      0,
    );
    setValue(
      "densityLOD",
      densityLODEnabled
        ? `enabled (${formatNumber(maxPointsPerPixel, 1)} pts/px)`
        : "disabled",
    );
    setValue(
      "densityCulledNodes",
      formatInteger(visibilityResult.densityCulledNodes),
    );
    setValue(
      "densityCulledPoints",
      formatInteger(visibilityResult.densityCulledPoints),
    );
    setValue(
      "nodeLoads",
      formatInteger(visibilityResult.nodeLoadPromises.length),
    );
    setValue(
      "loadingNodes",
      `${formatInteger(diagnostics.loadingNodeCount)} / ${formatInteger(
        diagnostics.maxLoadingNodeCount,
      )}`,
    );
    setValue("pointBudget", formatInteger(diagnostics.pointBudget));
    setValue("pointBudgetUse", formatPercent(diagnostics.pointBudgetUse));
    setValue(
      "lruPoints",
      diagnostics.lruPoints !== null
        ? formatInteger(diagnostics.lruPoints)
        : "-",
    );
    setValue(
      "lruNodes",
      diagnostics.lruNodes !== null ? formatInteger(diagnostics.lruNodes) : "-",
    );
    setValue(
      "lruBudgetUse",
      diagnostics.lruBudgetUse !== null
        ? formatPercent(diagnostics.lruBudgetUse)
        : "-",
    );
    setValue("gpuGeometries", formatInteger(renderInfo.memory.geometries));
    setValue("gpuTextures", formatInteger(renderInfo.memory.textures));
    setValue("jsHeap", heap);
    setValue("octreeReadMs", formatAverageMs(octreeRead));
    setValue("hierarchyLoadMs", formatAverageMs(hierarchyLoad));
    setValue("hierarchyParseMs", formatAverageMs(hierarchyParse));
    setValue("networkBytes", formatBytes(networkBytes));
    setValue("networkEvents", formatInteger(networkEvents));
    setValue(
      "bytesPerFetch",
      networkEvents > 0 ? formatBytes(networkBytes / networkEvents) : "-",
    );
    setValue(
      "octreeNodesPerFetch",
      octreeRead.totalFetchCount > 0
        ? formatNumber(octreeRead.count / octreeRead.totalFetchCount, 2)
        : "-",
    );
    setValue(
      "octreeCacheHitRate",
      octreeRead.count > 0
        ? formatPercent(octreeRead.cacheHitCount / octreeRead.count)
        : "-",
    );
    setValue(
      "octreeFetchRatio",
      octreeRead.totalBytes > 0
        ? `${formatNumber(octreeRead.totalFetchedBytes / octreeRead.totalBytes, 2)}x`
        : "-",
    );
    setValue(
      "networkThroughput",
      formatByteThroughput(networkBytes, networkMs),
    );
    setValue("workerWaitMs", formatAverageMs(workerWait));
    setValue("decompressMs", formatAverageMs(decompress));
    setValue("attributeDecodeMs", formatAverageMs(attributeDecode));
    setValue(
      "decodeMs",
      formatAverageFromTotals(decodeMs, attributeDecode.count),
    );
    setValue("transferMs", formatAverageMs(transfer));
    setValue("geometryMs", formatAverageMs(geometry));
    setValue("decodedPoints", formatInteger(decodedPoints));
    setValue(
      "decodeThroughput",
      formatPointThroughput(decodedPoints, decodeMs),
    );
    setValue("rawBufferBytes", formatBytes(rawBufferBytes));
    setValue("generatedBufferBytes", formatBytes(generatedBufferBytes));
    setValue("preciseBufferBytes", formatBytes(preciseBufferBytes));
    setValue("transferBufferBytes", formatBytes(transferBufferBytes));
    setValue(
      "generatedBytesPerPoint",
      decodedPoints > 0
        ? `${formatNumber(generatedBufferBytes / decodedPoints, 1)} B/pt`
        : "-",
    );
    setValue("pixelRatio", formatNumber(renderer.getPixelRatio(), 2));
    setValue(
      "canvas",
      `${formatInteger(rendererSize.width)} x ${formatInteger(rendererSize.height)}`,
    );
    setValue("camera", metrics.camera.type);
    setValue(
      "cameraPosition",
      [
        metrics.camera.position.x,
        metrics.camera.position.y,
        metrics.camera.position.z,
      ]
        .map((value) => formatNumber(value, 1))
        .join(", "),
    );
    setValue("edl", metrics.edlEnabled ? "enabled" : "disabled");
    setValue(
      "loadStatus",
      [
        visibilityResult.exceededMaxLoadsToGPU ? "GPU queue" : null,
        visibilityResult.nodeLoadFailed ? "load failed" : null,
      ]
        .filter(Boolean)
        .join(", ") || "ok",
    );
  }

  function setValue(key: PerformanceRowKey, value: string) {
    values.get(key)!.textContent = value;
  }

  function buildPanelText() {
    const lines = [
      "Performance",
      `Captured: ${new Date().toISOString()}`,
      "Order: avg / p95 / max",
      "",
    ];

    for (const section of sections) {
      lines.push(`[${section.title}]`);
      for (const [key, label] of section.rows) {
        lines.push(`${label}: ${values.get(key)?.textContent ?? "-"}`);
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd();
  }

  async function copyPanelText(text: string) {
    const originalLabel = copyButton.textContent ?? "Copy";

    try {
      await copyTextToClipboard(text);
      copyButton.textContent = "Copied";
    } catch (error) {
      console.error("Failed to copy performance metrics", error);
      copyButton.textContent = "Failed";
    }

    window.setTimeout(() => {
      copyButton.textContent = originalLabel;
    }, 1200);
  }

  return {
    dom,
    setPreset(name: string) {
      activePreset = name;
      setValue("activePreset", activePreset);
    },
    update,
  };
}

function createLoadMetrics() {
  const stages: PotreeLoadStage[] = [
    "hierarchy-load",
    "hierarchy-parse",
    "octree-slice-read",
    "worker-wait",
    "decompress",
    "attribute-decode",
    "worker-transfer",
    "geometry-creation",
  ];
  const stats = Object.fromEntries(
    stages.map((stage) => [
      stage,
      {
        count: 0,
        cacheHitCount: 0,
        totalBytes: 0,
        totalFetchedBytes: 0,
        totalFetchCount: 0,
        totalGeneratedBufferBytes: 0,
        totalPreciseBufferBytes: 0,
        totalRawBufferBytes: 0,
        totalTransferBufferBytes: 0,
        totalMs: 0,
        totalPoints: 0,
      },
    ]),
  ) as LoadMetricsSnapshot;

  return {
    instrumentation: {
      onStage(measurement: PotreeLoadMeasurement) {
        const stage = stats[measurement.stage];
        const fetchedByteSize = measurement.metadata?.fetchedByteSize;
        const generatedBufferBytes = measurement.metadata?.generatedBufferBytes;
        const preciseBufferBytes = measurement.metadata?.preciseBufferBytes;
        const rawBufferBytes = measurement.metadata?.rawBufferBytes;
        const transferBufferBytes = measurement.metadata?.transferBufferBytes;
        stage.count++;
        stage.cacheHitCount += measurement.metadata?.cacheHit === true ? 1 : 0;
        stage.totalMs += measurement.durationMs;
        stage.totalBytes += measurement.byteSize ?? 0;
        stage.totalFetchedBytes +=
          typeof fetchedByteSize === "number"
            ? fetchedByteSize
            : (measurement.byteSize ?? 0);
        stage.totalFetchCount +=
          measurement.metadata?.cacheHit === true ? 0 : 1;
        stage.totalGeneratedBufferBytes +=
          typeof generatedBufferBytes === "number" ? generatedBufferBytes : 0;
        stage.totalPreciseBufferBytes +=
          typeof preciseBufferBytes === "number" ? preciseBufferBytes : 0;
        stage.totalRawBufferBytes +=
          typeof rawBufferBytes === "number" ? rawBufferBytes : 0;
        stage.totalTransferBufferBytes +=
          typeof transferBufferBytes === "number" ? transferBufferBytes : 0;
        stage.totalPoints += measurement.numPoints ?? 0;
      },
    },
    reset() {
      for (const stage of stages) {
        stats[stage].count = 0;
        stats[stage].cacheHitCount = 0;
        stats[stage].totalBytes = 0;
        stats[stage].totalFetchedBytes = 0;
        stats[stage].totalFetchCount = 0;
        stats[stage].totalGeneratedBufferBytes = 0;
        stats[stage].totalPreciseBufferBytes = 0;
        stats[stage].totalRawBufferBytes = 0;
        stats[stage].totalTransferBufferBytes = 0;
        stats[stage].totalMs = 0;
        stats[stage].totalPoints = 0;
      }
    },
    snapshot(): LoadMetricsSnapshot {
      return Object.fromEntries(
        stages.map((stage) => [stage, { ...stats[stage] }]),
      ) as LoadMetricsSnapshot;
    },
  };
}

function snapshotRendererInfo(renderer: WebGLRenderer): RenderInfoSnapshot {
  return {
    memory: {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    },
    render: {
      calls: renderer.info.render.calls,
      points: renderer.info.render.points,
      triangles: renderer.info.render.triangles,
    },
  };
}

function createFrameStats(maxSamples: number) {
  const samples: FrameStatSample[] = [];

  return {
    add(sample: FrameStatSample) {
      samples.push(sample);
      if (samples.length > maxSamples) {
        samples.shift();
      }
    },
    summary(): FrameStatSummary {
      return {
        count: samples.length,
        cpuWorkMs: summarizeNumbers(samples.map((sample) => sample.cpuWorkMs)),
        gpuMs: summarizeNullableNumbers(samples.map((sample) => sample.gpuMs)),
        rafMs: summarizeNumbers(samples.map((sample) => sample.rafMs)),
        renderMs: summarizeNumbers(samples.map((sample) => sample.renderMs)),
        updateMs: summarizeNumbers(samples.map((sample) => sample.updateMs)),
        waitMs: summarizeNumbers(samples.map((sample) => sample.waitMs)),
      };
    },
  };
}

function summarizeNullableNumbers(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length === 0 ? null : summarizeNumbers(numbers);
}

function summarizeNumbers(values: number[]): MetricSummary {
  if (values.length === 0) {
    return { avg: 0, max: 0, p95: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1,
  );

  return {
    avg: total / sorted.length,
    max: sorted[sorted.length - 1],
    p95: sorted[p95Index],
  };
}

interface DisjointTimerQueryWebGL2 {
  GPU_DISJOINT_EXT: number;
  TIME_ELAPSED_EXT: number;
}

function createGpuTimer(renderer: WebGLRenderer) {
  const gl = renderer.getContext();
  const isWebGL2 =
    typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext;
  const ext = isWebGL2
    ? (gl.getExtension(
        "EXT_disjoint_timer_query_webgl2",
      ) as DisjointTimerQueryWebGL2 | null)
    : null;
  const supported = isWebGL2 && ext !== null;
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let lastMs: number | null = null;
  let averageMs: number | null = null;
  let status = supported ? "pending" : "unsupported";

  function poll() {
    if (!supported) {
      return;
    }

    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
    for (let i = 0; i < pending.length; ) {
      const query = pending[i];
      const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
      if (!available) {
        i++;
        continue;
      }

      pending.splice(i, 1);
      if (disjoint) {
        gl.deleteQuery(query);
        status = "disjoint";
        continue;
      }

      const elapsedNs = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      lastMs = elapsedNs / 1_000_000;
      averageMs = averageMs === null ? lastMs : averageMs * 0.9 + lastMs * 0.1;
      status = "ok";
    }
  }

  return {
    begin() {
      poll();
      if (!supported || active !== null) {
        return false;
      }

      active = gl.createQuery();
      if (active === null) {
        status = "unavailable";
        return false;
      }

      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
      return true;
    },
    end() {
      if (!supported || active === null) {
        return;
      }

      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    snapshot(): GpuTimingSnapshot {
      poll();
      return {
        averageMs,
        lastMs,
        pending: pending.length + (active === null ? 0 : 1),
        status,
        supported,
      };
    },
  };
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function formatNumber(value: number, maximumFractionDigits: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
  });
}

function formatPercent(value: number) {
  return `${formatNumber(value * 100, 1)}%`;
}

function formatAverageMs(summary: LoadStageSummary) {
  if (summary.count === 0) {
    return "-";
  }

  return `${formatNumber(summary.totalMs / summary.count, 2)} ms`;
}

function formatAverageFromTotals(totalMs: number, count: number) {
  if (count === 0) {
    return "-";
  }

  return `${formatNumber(totalMs / count, 2)} ms`;
}

function formatMetricMs(summary: MetricSummary | null) {
  if (summary === null) {
    return "-";
  }

  return `${formatNumber(summary.avg, 2)} / ${formatNumber(
    summary.p95,
    2,
  )} / ${formatNumber(summary.max, 2)} ms`;
}

function formatOptionalMs(value: number | null) {
  return value === null ? "-" : `${formatNumber(value, 2)} ms`;
}

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "-";
  }

  if (bytes < 1024) {
    return `${formatInteger(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${formatNumber(bytes / 1024, 1)} KB`;
  }

  return `${formatNumber(bytes / 1024 / 1024, 1)} MB`;
}

function formatByteThroughput(bytes: number, durationMs: number) {
  if (bytes === 0 || durationMs <= 0) {
    return "-";
  }

  return `${formatBytes(bytes / (durationMs / 1000))}/s`;
}

function formatPointThroughput(points: number, durationMs: number) {
  if (points === 0 || durationMs <= 0) {
    return "-";
  }

  return `${formatInteger(points / (durationMs / 1000))} pts/s`;
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function getHeapUsage() {
  const memory = (
    performance as Performance & {
      memory?: {
        totalJSHeapSize: number;
        usedJSHeapSize: number;
      };
    }
  ).memory;

  if (!memory) {
    return "-";
  }

  return `${formatMegabytes(memory.usedJSHeapSize)} / ${formatMegabytes(
    memory.totalJSHeapSize,
  )}`;
}

function formatMegabytes(bytes: number) {
  return `${formatNumber(bytes / 1024 / 1024, 1)} MB`;
}
