import {
  ClipMode,
  createClipBox,
  createClipSphere,
  LocalPotreeRequestManager,
  PointColorType,
  PointShape,
  type PointCloudOctree,
  PointSizeType,
  Potree,
  PotreeRenderer,
} from "potree-core";
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
import Stats from "stats.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { GUI } from "three/examples/jsm/libs/lil-gui.module.min.js";
import "./style.css";

document.body.onload = () => {
  const potree = new Potree();
  const pointClouds: PointCloudOctree[] = [];
  let clipPlanesTarget: PointCloudOctree | null = null;
  let pointCloudFrame: Mesh | null = null;
  let clipBoxHelperMesh: Mesh | null = null;
  let clipSphereHelperMesh: Mesh | null = null;

  // Clip plane state
  const clipPlaneX = new Plane(new Vector3(1, 0, 0), 0);
  const clipPlaneY = new Plane(new Vector3(0, 1, 0), 0);
  const clipPlaneZ = new Plane(new Vector3(0, 0, 1), 0);
  const planeCenter = new Vector3();
  const planeExtent = new Vector3();

  const clipPlaneState = {
    enableX: true,
    enableY: false,
    enableZ: false,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    showHelpers: true,
  };

  // Clip plane helpers
  const helperSize = 1;
  const clipHelperX = new PlaneHelper(clipPlaneX, helperSize, 0xe53935);
  const clipHelperY = new PlaneHelper(clipPlaneY, helperSize, 0x43a047);
  const clipHelperZ = new PlaneHelper(clipPlaneZ, helperSize, 0x1e88e5);
  clipHelperX.raycast = () => false;
  clipHelperY.raycast = () => false;
  clipHelperZ.raycast = () => false;

  function updateClipPlanes() {
    if (!clipPlanesTarget) return;
    const planes: Plane[] = [];
    if (clipPlaneState.enableX) planes.push(clipPlaneX);
    if (clipPlaneState.enableY) planes.push(clipPlaneY);
    if (clipPlaneState.enableZ) planes.push(clipPlaneZ);
    clipPlanesTarget.material.clippingPlanes =
      planes.length > 0 ? planes : null;

    clipHelperX.visible = clipPlaneState.showHelpers && clipPlaneState.enableX;
    clipHelperY.visible = clipPlaneState.showHelpers && clipPlaneState.enableY;
    clipHelperZ.visible = clipPlaneState.showHelpers && clipPlaneState.enableZ;
  }

  function updatePlaneConstant(axis: "X" | "Y" | "Z") {
    const plane =
      axis === "X" ? clipPlaneX : axis === "Y" ? clipPlaneY : clipPlaneZ;
    const offset =
      axis === "X"
        ? clipPlaneState.offsetX
        : axis === "Y"
          ? clipPlaneState.offsetY
          : clipPlaneState.offsetZ;
    const center =
      axis === "X"
        ? planeCenter.x
        : axis === "Y"
          ? planeCenter.y
          : planeCenter.z;
    const extent =
      axis === "X"
        ? planeExtent.x
        : axis === "Y"
          ? planeExtent.y
          : planeExtent.z;
    plane.constant = -(center + offset * extent);
    updateClipPlanes();
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
    sizeType: "Adaptive",
    pointShape: "Square",
    pointColorType: "RGB",
    showBoundingBox: false,
    // Transform
    transformMode: "translate",
    // Pick
    pickMethod: "Potree",
    // Local dataset
    localDatasetStatus: "初期データセットを表示中です。",
    loadLocalDataset: () => {
      localFileInput?.click();
    },
  };
  params.pointBudgetMP = Math.max(1, Math.round(potree.pointBudget / 1_000_000));
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

    void loadPointCloudFromSource(
      () =>
        potree.loadPointCloud(
          "metadata.json",
          LocalPotreeRequestManager.fromFileList(files),
        ),
      {
        position: new Vector3(0, -1.5, 3),
        rotation: new Euler(-Math.PI / 2, 0, 0),
        scale: new Vector3(2, 2, 2),
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
    antialias: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });

  const stats = new Stats();
  stats.showPanel(0);
  stats.dom.className = "playground-stats";
  document.body.appendChild(stats.dom);

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

  // Add clip plane helpers to scene (initially hidden until planes are configured)
  clipHelperX.visible = false;
  clipHelperY.visible = false;
  clipHelperZ.visible = false;
  scene.add(clipHelperX);
  scene.add(clipHelperY);
  scene.add(clipHelperZ);

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

  canvas.ondblclick = () => {
    const ray = raycaster.ray;
    let pickedPco: PointCloudOctree | null = null;

    if (params.pickMethod === "Potree") {
      const pick = Potree.pick(pointClouds, renderer, camera, ray);
      pickedPco = pick?.pointCloud ?? null;
    } else {
      const intersects = raycaster.intersectObjects(pointClouds, true);
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

    const intesects = raycaster.intersectObject(scene, true);
    if (intesects.length > 0) {
      const sphere = new Mesh(
        new SphereGeometry(0.2, 32, 32),
        new MeshBasicMaterial({ color: Math.random() * 0xaa4444 }),
      );
      sphere.position.copy(intesects[0].point);
      scene.add(sphere);
    }
  };

  // Load point cloud: pump
  void loadPointCloudFromSource(
    () => potree.loadPointCloud("metadata.json", "/data/pump/"),
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
    clipPlanesTarget = null;
    pointClouds.splice(0).forEach((pointCloud) => {
      scene.remove(pointCloud);
    });

    if (pointCloudFrame !== null) {
      scene.remove(pointCloudFrame);
      pointCloudFrame = null;
    }

    if (clipBoxHelperMesh !== null) {
      scene.remove(clipBoxHelperMesh);
      clipBoxHelperMesh = null;
    }

    if (clipSphereHelperMesh !== null) {
      scene.remove(clipSphereHelperMesh);
      clipSphereHelperMesh = null;
    }

    clipHelperX.visible = false;
    clipHelperY.visible = false;
    clipHelperZ.visible = false;
  }

  async function loadPointCloudFromSource(
    load: () => Promise<PointCloudOctree>,
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
      const pco = await load();
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

      const box = pco.pcoGeometry.boundingBox;
      const size = box.getSize(new Vector3());

      pointCloudFrame = new Mesh(
        new BoxGeometry(size.x, size.y, size.z),
        new MeshBasicMaterial({ color: 0xff0000, wireframe: true }),
      );
      pointCloudFrame.position.copy(pco.position);
      pointCloudFrame.scale.copy(pco.scale);
      pointCloudFrame.rotation.copy(pco.rotation);
      pointCloudFrame.raycast = () => false;
      size.multiplyScalar(0.5);
      pointCloudFrame.position.add(new Vector3(size.x, size.y, -size.z));
      scene.add(pointCloudFrame);

      if (options.applyClipPlanes) {
        clipPlanesTarget = pco;
      }

      pco.updateMatrixWorld(true);
      const worldBBox = pco.pcoGeometry.boundingBox
        .clone()
        .applyMatrix4(pco.matrixWorld);
      const center = worldBBox.getCenter(new Vector3());
      const worldSize = worldBBox.getSize(new Vector3());

      pco.material.clipMode = clipModeMap[params.clipMode];

      if (options.applyClipBox) {
        // ClipBox
        const halfSize = worldSize.clone().multiplyScalar(0.5);
        const clipBox = createClipBox(halfSize, center);
        pco.material.setClipBoxes([clipBox]);

        clipBoxHelperMesh = new Mesh(
          new BoxGeometry(halfSize.x, halfSize.y, halfSize.z),
          new MeshBasicMaterial({ color: 0x0066ff, wireframe: true }),
        );
        clipBoxHelperMesh.position.copy(center);
        clipBoxHelperMesh.raycast = () => false;
        scene.add(clipBoxHelperMesh);
      }

      if (options.applyClipPlanes) {
        // ClipPlane
        planeCenter.copy(center);
        planeExtent.copy(worldSize).multiplyScalar(0.5);

        clipPlaneX.constant = -planeCenter.x;
        clipPlaneY.constant = -planeCenter.y;
        clipPlaneZ.constant = -planeCenter.z;

        updateClipPlanes();
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

  // ---- gui ----
  const gui = new GUI({ title: "Playground Controls" });

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
    });
  performanceFolder
    .add(params, "maxNodesLoading", 1, 12, 1)
    .name("Max Nodes Loading")
    .onChange((value: number) => {
      potree.maxNumNodesLoading = Math.round(value);
    });

  // Camera folder
  const cameraFolder = gui.addFolder("Camera");
  cameraFolder
    .add(params, "orthographic")
    .name("Orthographic")
    .onChange((v: boolean) => switchCamera(v));

  // EDL folder
  const edlFolder = gui.addFolder("EDL");
  edlFolder
    .add(params, "edlEnabled")
    .name("Enabled")
    .onChange((v: boolean) => {
      potreeRenderer.setEDL({ enabled: v });
    });
  edlFolder
    .add(params, "edlStrength", 0, 5, 0.1)
    .name("Strength")
    .onChange((v: number) => {
      potreeRenderer.setEDL({ enabled: params.edlEnabled, strength: v });
    });
  edlFolder
    .add(params, "edlRadius", 0, 5, 0.1)
    .name("Radius")
    .onChange((v: number) => {
      potreeRenderer.setEDL({ enabled: params.edlEnabled, radius: v });
    });
  edlFolder
    .add(params, "edlOpacity", 0, 1, 0.05)
    .name("Opacity")
    .onChange((v: number) => {
      potreeRenderer.setEDL({ enabled: params.edlEnabled, opacity: v });
    });
  edlFolder
    .add(params, "edlNeighbours", 1, 16, 1)
    .name("Neighbours")
    .onChange((v: number) => {
      potreeRenderer.setEDL({ enabled: params.edlEnabled, neighbourCount: v });
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
    });

  // Clip Plane sub-folder
  const planeFolder = clipFolder.addFolder("Clip Planes");
  planeFolder
    .add(clipPlaneState, "enableX")
    .name("Enable X")
    .onChange(() => updateClipPlanes());
  planeFolder
    .add(clipPlaneState, "offsetX", -1, 1, 0.01)
    .name("X Offset")
    .onChange(() => updatePlaneConstant("X"));
  planeFolder
    .add(clipPlaneState, "enableY")
    .name("Enable Y")
    .onChange(() => updateClipPlanes());
  planeFolder
    .add(clipPlaneState, "offsetY", -1, 1, 0.01)
    .name("Y Offset")
    .onChange(() => updatePlaneConstant("Y"));
  planeFolder
    .add(clipPlaneState, "enableZ")
    .name("Enable Z")
    .onChange(() => updateClipPlanes());
  planeFolder
    .add(clipPlaneState, "offsetZ", -1, 1, 0.01)
    .name("Z Offset")
    .onChange(() => updatePlaneConstant("Z"));
  planeFolder
    .add(clipPlaneState, "showHelpers")
    .name("Show Helpers")
    .onChange(() => updateClipPlanes());

  // Points folder
  const pointsFolder = gui.addFolder("Points");
  pointsFolder
    .add(params, "pointSize", 0.1, 5, 0.1)
    .name("Size")
    .onChange((v: number) => {
      for (const pco of pointClouds) pco.material.size = v;
    });
  pointsFolder
    .add(params, "minPointSize", 1, 10, 0.5)
    .name("Min Size")
    .onChange((v: number) => {
      for (const pco of pointClouds) pco.material.minSize = v;
    });
  pointsFolder
    .add(params, "maxPointSize", 5, 100, 1)
    .name("Max Size")
    .onChange((v: number) => {
      for (const pco of pointClouds) pco.material.maxSize = v;
    });
  pointsFolder
    .add(params, "sizeType", ["Fixed", "Attenuated", "Adaptive"])
    .name("Size Type")
    .onChange((v: string) => {
      for (const pco of pointClouds) {
        pco.material.pointSizeType =
          pointSizeTypeMap[v] ?? PointSizeType.ADAPTIVE;
      }
    });
  pointsFolder
    .add(params, "pointShape", Object.keys(pointShapeMap))
    .name("Point Shape")
    .onChange((v: string) => {
      for (const pco of pointClouds) {
        pco.material.shape = pointShapeMap[v] ?? PointShape.SQUARE;
      }
    });
  pointsFolder
    .add(params, "pointColorType", Object.keys(pointColorTypeMap))
    .name("Color Type")
    .onChange((v: string) => {
      for (const pco of pointClouds) {
        pco.material.pointColorType = pointColorTypeMap[v] ?? PointColorType.RGB;
      }
    });
  pointsFolder
    .add(params, "showBoundingBox")
    .name("Bounding Box")
    .onChange((v: boolean) => {
      for (const pco of pointClouds) pco.showBoundingBox = v;
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
  performanceFolder.close();

  // ---- Render loop ----
  renderer.autoClear = false;

  renderer.setAnimationLoop(() => {
    timer.update();
    stats.begin();
    cube.rotation.y += 0.01;
    potree.updatePointClouds(pointClouds, camera, renderer);
    controls.update();

    // autoClear is disabled to allow ViewHelper to overlay on top of the scene.
    // As a result, we must clear manually at the start of each frame.
    renderer.clear();

    if (!params.edlEnabled) {
      renderer.render(scene, camera);
    } else {
      potreeRenderer.render({ renderer, scene, camera, pointClouds });
    }

    // Render ViewHelper
    viewHelper.render(renderer);
    if (viewHelper.animating) viewHelper.update(timer.getDelta());
    stats.end();
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
