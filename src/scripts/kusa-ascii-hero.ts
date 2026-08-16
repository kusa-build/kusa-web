type Point3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly brightness: number;
};

const gruvboxRamp = ["#504945", "#7c6f64", "#928374", "#98971a", "#b8bb26", "#fabd2f", "#ebdbb2"] as const;
const glyphRamp = [".", ":", "-", "+", "*", "=", "%", "@", "#", "&"] as const;
const rotationScalar = Math.PI * 0.2;
const autoRotationSpeed = 0.0004;
const autoRotationMaxDistance = 0.28;
const cameraDistance = 6;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function createWordModel(word: string): ReadonlyArray<Point3> {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 960;
  sampleCanvas.height = 280;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) {
    return [];
  }

  let fontSize = 236;
  const tracking = 7;
  sampleContext.font = `900 ${fontSize}px Arial Black, Arial, sans-serif`;
  let textWidth = sampleContext.measureText(word).width + tracking * (word.length - 1);
  while (textWidth > sampleCanvas.width * 0.9 && fontSize > 72) {
    fontSize -= 2;
    sampleContext.font = `900 ${fontSize}px Arial Black, Arial, sans-serif`;
    textWidth = sampleContext.measureText(word).width + tracking * (word.length - 1);
  }

  sampleContext.fillStyle = "#ffffff";
  sampleContext.textAlign = "left";
  sampleContext.textBaseline = "middle";
  let characterX = (sampleCanvas.width - textWidth) / 2;
  for (const character of word) {
    sampleContext.fillText(character, characterX, sampleCanvas.height / 2);
    characterX += sampleContext.measureText(character).width + tracking;
  }

  const pixels = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  const rawPoints: Array<{ readonly x: number; readonly y: number; readonly alpha: number }> = [];
  const sampleStep = 6;
  let minimumX = sampleCanvas.width;
  let maximumX = 0;
  let minimumY = sampleCanvas.height;
  let maximumY = 0;

  for (let y = 0; y < sampleCanvas.height; y += sampleStep) {
    for (let x = 0; x < sampleCanvas.width; x += sampleStep) {
      const alpha = pixels[(y * sampleCanvas.width + x) * 4 + 3] ?? 0;
      if (alpha < 90) {
        continue;
      }
      rawPoints.push({ x, y, alpha });
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
    }
  }

  if (rawPoints.length === 0) {
    return [];
  }

  function alphaAt(x: number, y: number): number {
    if (x < 0 || x >= sampleCanvas.width || y < 0 || y >= sampleCanvas.height) {
      return 0;
    }
    return pixels[(Math.round(y) * sampleCanvas.width + Math.round(x)) * 4 + 3] ?? 0;
  }

  const targetWidth = 2.9;
  const targetHeight = 1.28;
  const sourceWidth = Math.max(1, maximumX - minimumX);
  const sourceHeight = Math.max(1, maximumY - minimumY);
  const extrusionLayers = 6;
  const points: Array<Point3> = [];

  for (const rawPoint of rawPoints) {
    const normalizedX = (rawPoint.x - minimumX) / sourceWidth - 0.5;
    const normalizedY = 0.5 - (rawPoint.y - minimumY) / sourceHeight;
    const modelX = normalizedX * targetWidth;
    const modelY = normalizedY * targetHeight;
    const brightness = rawPoint.alpha / 255;

    points.push({
      x: modelX,
      y: modelY,
      z: 0.22,
      normalX: 0,
      normalY: 0,
      normalZ: 1,
      brightness,
    });
    points.push({
      x: modelX,
      y: modelY,
      z: -0.22,
      normalX: 0,
      normalY: 0,
      normalZ: -1,
      brightness: brightness * 0.7,
    });

    const leftAlpha = alphaAt(rawPoint.x - sampleStep, rawPoint.y);
    const rightAlpha = alphaAt(rawPoint.x + sampleStep, rawPoint.y);
    const topAlpha = alphaAt(rawPoint.x, rawPoint.y - sampleStep);
    const bottomAlpha = alphaAt(rawPoint.x, rawPoint.y + sampleStep);
    const edgeNormalX = (leftAlpha - rightAlpha) / 255;
    const edgeNormalY = (bottomAlpha - topAlpha) / 255;
    const edgeLength = Math.sqrt(edgeNormalX * edgeNormalX + edgeNormalY * edgeNormalY);

    if (edgeLength < 0.2) {
      continue;
    }

    for (let layer = 1; layer < extrusionLayers - 1; layer += 1) {
      const layerProgress = layer / (extrusionLayers - 1);
      points.push({
        x: modelX,
        y: modelY,
        z: (layerProgress - 0.5) * 0.44,
        normalX: edgeNormalX / edgeLength,
        normalY: edgeNormalY / edgeLength,
        normalZ: 0,
        brightness: brightness * 0.82,
      });
    }
  }

  return points;
}

function startKusaAsciiScene(): void {
  const stage = document.querySelector<HTMLElement>("#kusa-ascii-stage");
  const canvas = document.querySelector<HTMLCanvasElement>("#kusa-ascii-canvas");
  if (!stage || !canvas) {
    return;
  }

  const renderingContext = canvas.getContext("2d");
  if (!renderingContext) {
    return;
  }

  const asciiStage = stage;
  const asciiCanvas = canvas;
  const asciiContext = renderingContext;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const model = createWordModel("KUSA");
  const modelData = new Float32Array(model.length * 7);
  model.forEach((point, pointIndex) => {
    const offset = pointIndex * 7;
    modelData[offset] = point.x;
    modelData[offset + 1] = point.y;
    modelData[offset + 2] = point.z;
    modelData[offset + 3] = point.normalX;
    modelData[offset + 4] = point.normalY;
    modelData[offset + 5] = point.normalZ;
    modelData[offset + 6] = point.brightness;
  });
  const glyphAtlas = document.createElement("canvas");
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let cellWidth = 6.2;
  let cellHeight = 10.5;
  let atlasCellWidth = 0;
  let atlasCellHeight = 0;
  let columns = 0;
  let rows = 0;
  let depthBuffer = new Float32Array(0);
  let lightBuffer = new Float32Array(0);
  let litCells = new Int32Array(0);
  let pointerX = 0;
  let pointerY = 0;
  let pointerSeen = false;
  let yaw = 0;
  let pitch = 0;
  let framePending = false;

  function buildGlyphAtlas(fontSize: number): void {
    atlasCellWidth = Math.ceil(cellWidth * pixelRatio);
    atlasCellHeight = Math.ceil(cellHeight * pixelRatio);
    glyphAtlas.width = atlasCellWidth * glyphRamp.length;
    glyphAtlas.height = atlasCellHeight * gruvboxRamp.length;
    const atlasContext = glyphAtlas.getContext("2d");
    if (!atlasContext) {
      return;
    }
    atlasContext.font = `600 ${fontSize * pixelRatio}px SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    atlasContext.textAlign = "left";
    atlasContext.textBaseline = "top";
    atlasContext.globalAlpha = 0.95;
    gruvboxRamp.forEach((color, colorIndex) => {
      atlasContext.fillStyle = color;
      glyphRamp.forEach((glyph, glyphIndex) => {
        atlasContext.fillText(glyph, glyphIndex * atlasCellWidth, colorIndex * atlasCellHeight);
      });
    });
  }

  function resizeAsciiCanvas(): void {
    const bounds = asciiStage.getBoundingClientRect();
    width = Math.max(320, Math.round(bounds.width));
    height = Math.max(420, Math.round(bounds.height));
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const fontSize = width < 520 ? 8 : width < 1_000 ? 9 : 10;
    cellWidth = fontSize * 0.62;
    cellHeight = fontSize * 1.08;
    columns = Math.ceil(width / cellWidth);
    rows = Math.ceil(height / cellHeight);
    asciiCanvas.width = Math.round(width * pixelRatio);
    asciiCanvas.height = Math.round(height * pixelRatio);
    asciiCanvas.style.width = `${width}px`;
    asciiCanvas.style.height = `${height}px`;
    asciiContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    depthBuffer = new Float32Array(columns * rows);
    lightBuffer = new Float32Array(columns * rows);
    litCells = new Int32Array(columns * rows);
    buildGlyphAtlas(fontSize);
    scheduleFrame();
  }

  function targetRotation(timestamp: number): { readonly yaw: number; readonly pitch: number } {
    if (reducedMotion.matches) {
      return { yaw: -0.35, pitch: -0.1 };
    }
    if (pointerSeen) {
      return { yaw: pointerX * rotationScalar, pitch: pointerY * rotationScalar };
    }
    return {
      yaw: Math.sin(timestamp * autoRotationSpeed) * autoRotationMaxDistance,
      pitch: Math.cos(timestamp * autoRotationSpeed) * autoRotationMaxDistance * 0.35,
    };
  }

  function renderAsciiModel(): void {
    depthBuffer.fill(-100);
    let litCount = 0;
    const cosineYaw = Math.cos(yaw);
    const sineYaw = Math.sin(yaw);
    const cosinePitch = Math.cos(pitch);
    const sinePitch = Math.sin(pitch);
    const scale = Math.min(width * 0.25, height * 0.37);
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    for (let offset = 0; offset < modelData.length; offset += 7) {
      const pointX = modelData[offset] ?? 0;
      const pointY = modelData[offset + 1] ?? 0;
      const pointZ = modelData[offset + 2] ?? 0;
      const yawX = pointX * cosineYaw - pointZ * sineYaw;
      const yawZ = pointX * sineYaw + pointZ * cosineYaw;
      const rotatedY = pointY * cosinePitch - yawZ * sinePitch;
      const rotatedZ = pointY * sinePitch + yawZ * cosinePitch;
      const perspective = cameraDistance / (cameraDistance - rotatedZ);
      const column = Math.floor((halfWidth + yawX * scale * perspective) / cellWidth);
      const row = Math.floor((halfHeight - rotatedY * scale * perspective) / cellHeight);
      if (column < 0 || column >= columns || row < 0 || row >= rows) {
        continue;
      }

      const index = row * columns + column;
      const depth = rotatedZ * perspective;
      const previousDepth = depthBuffer[index] ?? -100;
      if (depth <= previousDepth) {
        continue;
      }
      if (previousDepth === -100) {
        litCells[litCount] = index;
        litCount += 1;
      }

      const normalX = modelData[offset + 3] ?? 0;
      const normalY = modelData[offset + 4] ?? 0;
      const normalZ = modelData[offset + 5] ?? 0;
      const normalYawX = normalX * cosineYaw - normalZ * sineYaw;
      const normalYawZ = normalX * sineYaw + normalZ * cosineYaw;
      const rotatedNormalY = normalY * cosinePitch - normalYawZ * sinePitch;
      const rotatedNormalZ = normalY * sinePitch + normalYawZ * cosinePitch;
      const directionalLight = Math.max(
        0,
        normalYawX * -0.34 + rotatedNormalY * 0.42 + rotatedNormalZ * 0.82,
      );
      const depthLight = clamp((rotatedZ + 0.8) / 1.7, 0, 1);
      depthBuffer[index] = depth;
      lightBuffer[index] = clamp(
        0.1 + directionalLight * 0.48 + depthLight * 0.18 + (modelData[offset + 6] ?? 0) * 0.2,
        0.04,
        1,
      );
    }

    asciiContext.clearRect(0, 0, width, height);
    const destinationWidth = atlasCellWidth / pixelRatio;
    const destinationHeight = atlasCellHeight / pixelRatio;

    for (let litIndex = 0; litIndex < litCount; litIndex += 1) {
      const index = litCells[litIndex] ?? 0;
      const light = lightBuffer[index] ?? 0;
      const glyphIndex = Math.min(glyphRamp.length - 1, Math.floor(light * glyphRamp.length));
      const colorIndex = Math.min(gruvboxRamp.length - 1, Math.floor(light * gruvboxRamp.length));
      asciiContext.drawImage(
        glyphAtlas,
        glyphIndex * atlasCellWidth,
        colorIndex * atlasCellHeight,
        atlasCellWidth,
        atlasCellHeight,
        (index % columns) * cellWidth,
        Math.floor(index / columns) * cellHeight,
        destinationWidth,
        destinationHeight,
      );
    }
  }

  function scheduleFrame(): void {
    if (!framePending) {
      framePending = true;
      window.requestAnimationFrame(renderAsciiFrame);
    }
  }

  function renderAsciiFrame(timestamp: number): void {
    framePending = false;
    const target = targetRotation(timestamp);
    const yawDelta = target.yaw - yaw;
    const pitchDelta = target.pitch - pitch;
    const settled =
      (pointerSeen || reducedMotion.matches) &&
      Math.abs(yawDelta) < 0.0005 &&
      Math.abs(pitchDelta) < 0.0005;

    if (settled) {
      yaw = target.yaw;
      pitch = target.pitch;
      renderAsciiModel();
      return;
    }

    yaw += yawDelta * 0.35;
    pitch += pitchDelta * 0.35;
    renderAsciiModel();
    scheduleFrame();
  }

  window.addEventListener(
    "pointermove",
    (event) => {
      pointerX = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
      pointerY = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
      pointerSeen = true;
      scheduleFrame();
    },
    { passive: true },
  );
  reducedMotion.addEventListener("change", scheduleFrame);

  const resizeObserver = new ResizeObserver(resizeAsciiCanvas);
  resizeObserver.observe(asciiStage);
  resizeAsciiCanvas();
}

startKusaAsciiScene();
