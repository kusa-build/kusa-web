type Point3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly brightness: number;
  readonly seed: number;
};

type RotatedPoint = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
};

type AsciiPalette = {
  readonly name: string;
  readonly colors: readonly [string, string, string, string, string, string];
  readonly glow: string;
};

type OrbitGlyph = {
  readonly radius: number;
  readonly height: number;
  readonly depthScale: number;
  readonly angle: number;
  readonly speed: number;
  readonly seed: number;
};

type AnimationPhase = "word" | "to-loader" | "loader" | "to-word";

const pacificPalette: AsciiPalette = {
  name: "PACIFIC",
  colors: ["#18306f", "#215495", "#277dab", "#32a9bd", "#45d5c6", "#83f4c5"],
  glow: "#237f91",
};

const asciiPalettes: ReadonlyArray<AsciiPalette> = [
  pacificPalette,
  {
    name: "ORCHID",
    colors: ["#3c205f", "#60327f", "#8945a5", "#b45fcb", "#da86e7", "#f3b4ff"],
    glow: "#8b45a5",
  },
  {
    name: "EMBER",
    colors: ["#542739", "#85383c", "#b94e3f", "#df7147", "#f6a85c", "#ffe09a"],
    glow: "#a94b3d",
  },
  {
    name: "KAWAYAN",
    colors: ["#153d39", "#1d6655", "#288d6c", "#35b987", "#65dda6", "#b7f6bd"],
    glow: "#287c62",
  },
];

const wordSequence = ["KUSA", "AUTOMATIC"] as const;
const glyphRamp = [".", ":", "-", "=", "+", "*", "#", "%", "@"] as const;
const debrisGlyphs = ["0", "@", "~", "=", ":", "%", "+", "#"] as const;
const glitchGlyphs = ["1", "0", "a", "7", "=", "[", "]", "#", "@", "/", "\\", "%"] as const;

function deterministicNumber(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function createWordModel(word: string, seedOffset: number): ReadonlyArray<Point3> {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 960;
  sampleCanvas.height = 280;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) {
    return [];
  }

  let fontSize = 236;
  const tracking = word === "KUSA" ? 7 : 18;
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
      const alphaIndex = (y * sampleCanvas.width + x) * 4 + 3;
      const alpha = pixels[alphaIndex] ?? 0;
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

  const targetWidth = word === "KUSA" ? 2.9 : 3.65;
  const targetHeight = word === "KUSA" ? 1.28 : 1.12;
  const sourceWidth = Math.max(1, maximumX - minimumX);
  const sourceHeight = Math.max(1, maximumY - minimumY);
  const extrusionLayers = 6;
  const points: Array<Point3> = [];

  function alphaAt(x: number, y: number): number {
    if (x < 0 || x >= sampleCanvas.width || y < 0 || y >= sampleCanvas.height) {
      return 0;
    }
    return pixels[(Math.round(y) * sampleCanvas.width + Math.round(x)) * 4 + 3] ?? 0;
  }

  rawPoints.forEach((rawPoint, rawIndex) => {
    const normalizedX = (rawPoint.x - minimumX) / sourceWidth - 0.5;
    const normalizedY = 0.5 - (rawPoint.y - minimumY) / sourceHeight;
    const modelX = normalizedX * targetWidth;
    const modelY = normalizedY * targetHeight;
    const frontSeed = rawIndex * extrusionLayers + seedOffset * 10_000;
    const brightness = rawPoint.alpha / 255;
    points.push({
      x: modelX,
      y: modelY,
      z: 0.34,
      normalX: 0,
      normalY: 0,
      normalZ: 1,
      brightness,
      seed: frontSeed,
    });
    points.push({
      x: modelX,
      y: modelY,
      z: -0.34,
      normalX: 0,
      normalY: 0,
      normalZ: -1,
      brightness: brightness * 0.7,
      seed: frontSeed + 1,
    });

    const leftAlpha = alphaAt(rawPoint.x - sampleStep, rawPoint.y);
    const rightAlpha = alphaAt(rawPoint.x + sampleStep, rawPoint.y);
    const topAlpha = alphaAt(rawPoint.x, rawPoint.y - sampleStep);
    const bottomAlpha = alphaAt(rawPoint.x, rawPoint.y + sampleStep);
    const edgeNormalX = (leftAlpha - rightAlpha) / 255;
    const edgeNormalY = (bottomAlpha - topAlpha) / 255;
    const edgeLength = Math.sqrt(edgeNormalX * edgeNormalX + edgeNormalY * edgeNormalY);

    if (edgeLength < 0.2) {
      return;
    }

    for (let layer = 1; layer < extrusionLayers - 1; layer += 1) {
      const layerProgress = layer / (extrusionLayers - 1);
      points.push({
        x: modelX,
        y: modelY,
        z: (layerProgress - 0.5) * 0.68,
        normalX: edgeNormalX / edgeLength,
        normalY: edgeNormalY / edgeLength,
        normalZ: 0,
        brightness: brightness * 0.82,
        seed: frontSeed + layer + 1,
      });
    }
  });

  return points;
}

function createLoaderModel(): ReadonlyArray<Point3> {
  const points: Array<Point3> = [];
  const majorSteps = 150;
  const minorSteps = 24;
  const majorRadius = 0.82;
  const minorRadius = 0.23;

  for (let majorIndex = 0; majorIndex < majorSteps; majorIndex += 1) {
    const majorAngle = (majorIndex / majorSteps) * Math.PI * 2;
    const normalizedGapAngle = Math.atan2(Math.sin(majorAngle), Math.cos(majorAngle));
    if (Math.abs(normalizedGapAngle) < 0.28) {
      continue;
    }

    for (let minorIndex = 0; minorIndex < minorSteps; minorIndex += 1) {
      const minorAngle = (minorIndex / minorSteps) * Math.PI * 2;
      const ringRadius = majorRadius + Math.cos(minorAngle) * minorRadius;
      points.push({
        x: Math.cos(majorAngle) * ringRadius,
        y: Math.sin(minorAngle) * minorRadius,
        z: Math.sin(majorAngle) * ringRadius,
        normalX: Math.cos(majorAngle) * Math.cos(minorAngle),
        normalY: Math.sin(minorAngle),
        normalZ: Math.sin(majorAngle) * Math.cos(minorAngle),
        brightness: 0.9,
        seed: 100_000 + majorIndex * minorSteps + minorIndex,
      });
    }
  }

  return points;
}

function createOrbitGlyphs(): ReadonlyArray<OrbitGlyph> {
  return Array.from({ length: 96 }, (_, index) => ({
    radius: 1.65 + deterministicNumber(index, 41) * 0.9,
    height: (deterministicNumber(index, 42) - 0.5) * 1.9,
    depthScale: 0.45 + deterministicNumber(index, 43) * 0.7,
    angle: deterministicNumber(index, 44) * Math.PI * 2,
    speed: 0.00008 + deterministicNumber(index, 45) * 0.00012,
    seed: index,
  }));
}

function rotatePoint(point: Point3, yaw: number, pitch: number, roll: number): RotatedPoint {
  const cosineYaw = Math.cos(yaw);
  const sineYaw = Math.sin(yaw);
  const cosinePitch = Math.cos(pitch);
  const sinePitch = Math.sin(pitch);
  const cosineRoll = Math.cos(roll);
  const sineRoll = Math.sin(roll);
  const yawX = point.x * cosineYaw - point.z * sineYaw;
  const yawZ = point.x * sineYaw + point.z * cosineYaw;
  const pitchY = point.y * cosinePitch - yawZ * sinePitch;
  const pitchZ = point.y * sinePitch + yawZ * cosinePitch;
  const normalYawX = point.normalX * cosineYaw - point.normalZ * sineYaw;
  const normalYawZ = point.normalX * sineYaw + point.normalZ * cosineYaw;
  const normalPitchY = point.normalY * cosinePitch - normalYawZ * sinePitch;
  const normalPitchZ = point.normalY * sinePitch + normalYawZ * cosinePitch;

  return {
    x: yawX * cosineRoll - pitchY * sineRoll,
    y: yawX * sineRoll + pitchY * cosineRoll,
    z: pitchZ,
    normalX: normalYawX * cosineRoll - normalPitchY * sineRoll,
    normalY: normalYawX * sineRoll + normalPitchY * cosineRoll,
    normalZ: normalPitchZ,
  };
}

function startKusaAsciiScene(): void {
  const stage = document.querySelector<HTMLElement>("#kusa-ascii-stage");
  const control = document.querySelector<HTMLButtonElement>("#kusa-ascii-control");
  const canvas = document.querySelector<HTMLCanvasElement>("#kusa-ascii-canvas");
  const wordLabel = document.querySelector<HTMLElement>("#kusa-ascii-word");
  const liveWord = document.querySelector<HTMLElement>("#kusa-ascii-live-word");
  const paletteLabel = document.querySelector<HTMLElement>("#kusa-ascii-palette");
  const cycleLabel = document.querySelector<HTMLElement>("#kusa-ascii-cycle");

  if (!stage || !control || !canvas || !wordLabel || !liveWord || !paletteLabel || !cycleLabel) {
    return;
  }

  const renderingContext = canvas.getContext("2d");
  if (!renderingContext) {
    return;
  }

  const asciiStage = stage;
  const asciiControl = control;
  const asciiCanvas = canvas;
  const asciiContext = renderingContext;
  const asciiWordLabel = wordLabel;
  const asciiLiveWord = liveWord;
  const asciiPaletteLabel = paletteLabel;
  const asciiCycleLabel = cycleLabel;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const wordModels = wordSequence.map((word, index) => createWordModel(word, index + 1));
  const loaderModel = createLoaderModel();
  const orbitGlyphs = createOrbitGlyphs();
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let fontSize = 10;
  let cellWidth = 6.2;
  let cellHeight = 10.5;
  let columns = 0;
  let rows = 0;
  let depthBuffer = new Float32Array(0);
  let lightBuffer = new Float32Array(0);
  let seedBuffer = new Float64Array(0);
  let kindBuffer = new Uint8Array(0);
  let phase: AnimationPhase = "word";
  let phaseStartedAt = performance.now();
  let wordIndex = 0;
  let paletteIndex = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;
  let smoothPointerX = 0;
  let smoothPointerY = 0;
  let lastRenderedAt = 0;

  function currentWord(): (typeof wordSequence)[number] {
    return wordSequence[wordIndex] ?? wordSequence[0];
  }

  function currentWordModel(): ReadonlyArray<Point3> {
    return wordModels[wordIndex] ?? wordModels[0] ?? [];
  }

  function currentPalette(): AsciiPalette {
    return asciiPalettes[paletteIndex] ?? pacificPalette;
  }

  function setWordReadout(word: string): void {
    asciiWordLabel.textContent = word;
    asciiLiveWord.textContent = word;
  }

  function resizeAsciiCanvas(): void {
    const bounds = asciiStage.getBoundingClientRect();
    width = Math.max(320, Math.round(bounds.width));
    height = Math.max(420, Math.round(bounds.height));
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    fontSize = width < 520 ? 8 : width < 1_000 ? 9 : 10;
    cellWidth = fontSize * 0.62;
    cellHeight = fontSize * 1.08;
    columns = Math.ceil(width / cellWidth);
    rows = Math.ceil(height / cellHeight);
    asciiCanvas.width = Math.round(width * pixelRatio);
    asciiCanvas.height = Math.round(height * pixelRatio);
    asciiCanvas.style.width = `${width}px`;
    asciiCanvas.style.height = `${height}px`;
    asciiContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const cellCount = columns * rows;
    depthBuffer = new Float32Array(cellCount);
    lightBuffer = new Float32Array(cellCount);
    seedBuffer = new Float64Array(cellCount);
    kindBuffer = new Uint8Array(cellCount);
  }

  function writeProjectedPoint(
    point: Point3,
    yaw: number,
    pitch: number,
    roll: number,
    scale: number,
    glitch: number,
    timestamp: number,
  ): void {
    const glitchFrame = Math.floor(timestamp / 48);
    if (glitch > 0 && deterministicNumber(point.seed + glitchFrame, 71) < glitch * 0.22) {
      return;
    }

    const rotated = rotatePoint(point, yaw, pitch, roll);
    const perspective = 4.5 / (4.5 - rotated.z);
    let screenX = width / 2 + rotated.x * scale * perspective;
    let screenY = height / 2 - rotated.y * scale * perspective;
    const projectedRow = Math.floor(screenY / cellHeight);

    if (glitch > 0) {
      const rowShift = (deterministicNumber(projectedRow + glitchFrame, 72) - 0.5) * width * 0.13 * glitch;
      const pointJitter = (deterministicNumber(point.seed + glitchFrame, 73) - 0.5) * 18 * glitch;
      screenX += rowShift + pointJitter;
      screenY += (deterministicNumber(point.seed + glitchFrame, 74) - 0.5) * 8 * glitch;
    }

    const column = Math.floor(screenX / cellWidth);
    const row = Math.floor(screenY / cellHeight);
    if (column < 0 || column >= columns || row < 0 || row >= rows) {
      return;
    }

    const index = row * columns + column;
    const depth = rotated.z * perspective;
    if (kindBuffer[index] !== 0 && depth <= (depthBuffer[index] ?? -100)) {
      return;
    }

    const directionalLight = Math.max(
      0,
      rotated.normalX * -0.34 + rotated.normalY * 0.42 + rotated.normalZ * 0.82,
    );
    const depthLight = clamp((rotated.z + 0.8) / 1.7, 0, 1);
    const scanLight = Math.sin(row * 0.72 + timestamp * 0.0014) * 0.04;
    const light = clamp(0.12 + directionalLight * 0.42 + depthLight * 0.18 + point.brightness * 0.22 + scanLight, 0.04, 1);
    depthBuffer[index] = depth;
    lightBuffer[index] = Math.max(lightBuffer[index] ?? 0, light);
    seedBuffer[index] = point.seed;
    kindBuffer[index] = 1;
  }

  function writeOrbitGlyphs(
    timestamp: number,
    yaw: number,
    pitch: number,
    scale: number,
    glitch: number,
  ): void {
    orbitGlyphs.forEach((orbitGlyph) => {
      const angle = orbitGlyph.angle + timestamp * orbitGlyph.speed;
      const point: Point3 = {
        x: Math.cos(angle) * orbitGlyph.radius,
        y: orbitGlyph.height + Math.sin(timestamp * 0.0005 + orbitGlyph.seed) * 0.08,
        z: Math.sin(angle) * orbitGlyph.radius * orbitGlyph.depthScale,
        normalX: 0,
        normalY: 0,
        normalZ: 1,
        brightness: 0.3,
        seed: 200_000 + orbitGlyph.seed,
      };
      const rotated = rotatePoint(point, yaw * 0.65, pitch * 0.5, 0);
      const perspective = 4.5 / (4.5 - rotated.z);
      const spread = 1 + glitch * 0.32;
      const screenX = width / 2 + rotated.x * scale * perspective * spread;
      const screenY = height / 2 - rotated.y * scale * perspective * spread;
      const column = Math.floor(screenX / cellWidth);
      const row = Math.floor(screenY / cellHeight);
      if (column < 0 || column >= columns || row < 0 || row >= rows) {
        return;
      }
      const index = row * columns + column;
      if (kindBuffer[index] !== 0) {
        return;
      }
      depthBuffer[index] = rotated.z;
      lightBuffer[index] = 0.18 + deterministicNumber(orbitGlyph.seed, 75) * 0.23;
      seedBuffer[index] = orbitGlyph.seed;
      kindBuffer[index] = 2;
    });
  }

  function writeGlitchNoise(timestamp: number, glitch: number): void {
    const glitchFrame = Math.floor(timestamp / 48);
    const noiseCount = Math.floor(glitch * Math.min(520, columns * 2.4));

    for (let noiseIndex = 0; noiseIndex < noiseCount; noiseIndex += 1) {
      const column = Math.floor((0.12 + deterministicNumber(noiseIndex + glitchFrame, 81) * 0.76) * columns);
      const row = Math.floor((0.18 + deterministicNumber(noiseIndex + glitchFrame, 82) * 0.64) * rows);
      const index = row * columns + column;
      kindBuffer[index] = 3;
      lightBuffer[index] = 0.2 + deterministicNumber(noiseIndex + glitchFrame, 83) * 0.65;
      seedBuffer[index] = noiseIndex + glitchFrame * 1_000;
    }
  }

  function drawAsciiBuffers(timestamp: number, glitch: number): void {
    const palette = currentPalette();
    const glitchFrame = Math.floor(timestamp / 48);
    asciiContext.clearRect(0, 0, width, height);
    asciiContext.font = `600 ${fontSize}px SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    asciiContext.textAlign = "left";
    asciiContext.textBaseline = "top";

    for (let row = 0; row < rows; row += 1) {
      const blackedOut = glitch > 0.25 && deterministicNumber(row + glitchFrame, 91) < glitch * 0.08;
      if (blackedOut) {
        continue;
      }

      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const kind = kindBuffer[index] ?? 0;
        if (kind === 0) {
          continue;
        }

        const light = clamp(lightBuffer[index] ?? 0, 0, 1);
        const seed = Math.floor(seedBuffer[index] ?? 0);
        const colorIndex = Math.min(palette.colors.length - 1, Math.floor(light * palette.colors.length));
        const color = palette.colors[colorIndex] ?? palette.colors[0];
        let glyph: string;

        if (kind === 2) {
          const debrisIndex = Math.floor(deterministicNumber(seed, 92) * debrisGlyphs.length);
          glyph = debrisGlyphs[debrisIndex] ?? debrisGlyphs[0];
        } else if (kind === 3 || glitch > 0 && deterministicNumber(seed + glitchFrame, 93) < glitch * 0.62) {
          const glitchIndex = Math.floor(deterministicNumber(seed + glitchFrame, 94) * glitchGlyphs.length);
          glyph = glitchGlyphs[glitchIndex] ?? glitchGlyphs[0];
        } else {
          const glyphIndex = Math.min(glyphRamp.length - 1, Math.floor(light * glyphRamp.length));
          glyph = glyphRamp[glyphIndex] ?? glyphRamp[0];
        }

        asciiContext.fillStyle = color;
        asciiContext.globalAlpha = kind === 2 ? 0.66 : 0.92;
        asciiContext.fillText(glyph, column * cellWidth, row * cellHeight);
      }
    }
    asciiContext.globalAlpha = 1;
  }

  function renderAsciiModel(
    model: ReadonlyArray<Point3>,
    timestamp: number,
    glitch: number,
    isLoader: boolean,
  ): void {
    depthBuffer.fill(-100);
    lightBuffer.fill(0);
    kindBuffer.fill(0);
    const targetPointerX = pointerActive ? pointerX : 0;
    const targetPointerY = pointerActive ? pointerY : 0;
    smoothPointerX += (targetPointerX - smoothPointerX) * 0.055;
    smoothPointerY += (targetPointerY - smoothPointerY) * 0.055;
    const restingYaw = currentWord() === "AUTOMATIC" ? -0.14 : -0.24;
    const idleYaw = reducedMotion.matches ? restingYaw : restingYaw + Math.sin(timestamp * 0.00045) * 0.09;
    const idlePitch = reducedMotion.matches ? 0 : Math.sin(timestamp * 0.00031) * 0.055;
    const yaw = isLoader
      ? -0.32 + Math.sin(timestamp * 0.0007) * 0.24 + smoothPointerX * 0.18
      : idleYaw + smoothPointerX * 0.22;
    const pitch = isLoader
      ? 0.42 + Math.sin(timestamp * 0.0004) * 0.08 + smoothPointerY * 0.12
      : -0.06 + idlePitch + smoothPointerY * 0.18;
    const roll = isLoader ? timestamp * 0.0011 : Math.sin(timestamp * 0.00023) * 0.035;
    const baseScale = Math.min(width * 0.25, height * 0.37);
    const scale = isLoader
      ? baseScale * 0.78
      : currentWord() === "AUTOMATIC"
        ? Math.min(width * 0.205, height * 0.37)
        : baseScale;

    model.forEach((point) => {
      writeProjectedPoint(point, yaw, pitch, roll, scale, glitch, timestamp);
    });
    writeOrbitGlyphs(timestamp, yaw, pitch, scale, glitch);
    if (glitch > 0) {
      writeGlitchNoise(timestamp, glitch);
    }
    drawAsciiBuffers(timestamp, glitch);
  }

  function transitionGlitch(progress: number): number {
    return progress < 0.5 ? progress * 2 : (1 - progress) * 2;
  }

  function renderAnimationPhase(timestamp: number): void {
    const elapsed = timestamp - phaseStartedAt;

    if (phase === "word") {
      renderAsciiModel(currentWordModel(), timestamp, 0, false);
      if (!reducedMotion.matches && elapsed >= 5_000) {
        phase = "to-loader";
        phaseStartedAt = timestamp;
        asciiWordLabel.textContent = "···";
      }
      return;
    }

    if (phase === "to-loader") {
      const progress = Math.min(1, elapsed / 900);
      const model = progress < 0.5 ? currentWordModel() : loaderModel;
      renderAsciiModel(model, timestamp, transitionGlitch(progress), progress >= 0.5);
      if (progress >= 1) {
        phase = "loader";
        phaseStartedAt = timestamp;
      }
      return;
    }

    if (phase === "loader") {
      renderAsciiModel(loaderModel, timestamp, 0, true);
      if (elapsed >= 1_050) {
        phase = "to-word";
        phaseStartedAt = timestamp;
        wordIndex = (wordIndex + 1) % wordSequence.length;
      }
      return;
    }

    const progress = Math.min(1, elapsed / 900);
    const model = progress < 0.5 ? loaderModel : currentWordModel();
    renderAsciiModel(model, timestamp, transitionGlitch(progress), progress < 0.5);
    if (progress >= 1) {
      phase = "word";
      phaseStartedAt = timestamp;
      setWordReadout(currentWord());
    }
  }

  function renderAsciiFrame(timestamp: number): void {
    if (timestamp - lastRenderedAt >= 32) {
      renderAnimationPhase(timestamp);
      lastRenderedAt = timestamp;
    }
    window.requestAnimationFrame(renderAsciiFrame);
  }

  function updatePointer(event: PointerEvent): void {
    pointerX = (event.clientX / width - 0.5) * 2;
    pointerY = (event.clientY / height - 0.5) * 2;
    pointerActive = true;
  }

  function cycleAsciiPalette(): void {
    paletteIndex = (paletteIndex + 1) % asciiPalettes.length;
    const palette = currentPalette();
    asciiPaletteLabel.textContent = palette.name;
    asciiCycleLabel.textContent = String(paletteIndex + 1).padStart(2, "0");
    asciiStage.style.setProperty("--ascii-glow", palette.glow);
    asciiStage.dataset.flash = "true";
    window.setTimeout(() => {
      delete asciiStage.dataset.flash;
    }, 260);
  }

  asciiControl.addEventListener("pointermove", updatePointer);
  asciiControl.addEventListener("pointerenter", updatePointer);
  asciiControl.addEventListener("pointerleave", () => {
    pointerActive = false;
  });
  asciiControl.addEventListener("click", cycleAsciiPalette);
  reducedMotion.addEventListener("change", () => {
    phase = "word";
    phaseStartedAt = performance.now();
    setWordReadout(currentWord());
  });

  const resizeObserver = new ResizeObserver(resizeAsciiCanvas);
  resizeObserver.observe(asciiStage);
  resizeAsciiCanvas();
  setWordReadout(currentWord());
  window.requestAnimationFrame(renderAsciiFrame);
}

startKusaAsciiScene();
