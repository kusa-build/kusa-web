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
const bootDurationMs = 900;
const viewTransitionDurationMs = 560;
const glowRadius = 130;
const routes = ["purpose", "values", "posts", "contact"] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function cellHash(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
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

function createModelData(word: string): Float32Array {
  const model = createWordModel(word);
  const data = new Float32Array(model.length * 7);
  model.forEach((point, pointIndex) => {
    const offset = pointIndex * 7;
    data[offset] = point.x;
    data[offset + 1] = point.y;
    data[offset + 2] = point.z;
    data[offset + 3] = point.normalX;
    data[offset + 4] = point.normalY;
    data[offset + 5] = point.normalZ;
    data[offset + 6] = point.brightness;
  });
  return data;
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
  const kusaModelData = createModelData("KUSA");
  const homeControl = asciiStage.querySelector<HTMLAnchorElement>(".ascii-home");
  const homeWord = asciiStage.querySelector<HTMLElement>(".ascii-home .home-word");
  const navLinks = asciiStage.querySelectorAll<HTMLAnchorElement>(".ascii-nav a");
  const sections = asciiStage.querySelectorAll<HTMLElement>(".site-section");
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
  let pointerClientX = 0;
  let pointerClientY = 0;
  let pointerSeen = false;
  let yaw = 0;
  let pitch = 0;
  let framePending = false;
  let bootStartedAt = -1;
  let viewProgress = routes.includes(location.hash.slice(1) as (typeof routes)[number]) ? 1 : 0;
  let transitionFrom = viewProgress;
  let transitionTarget = viewProgress;
  let transitionStartedAt = -1;
  let focusAfterTransition = "";

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

  function drawAsciiModel(
    modelData: Float32Array,
    timestamp: number,
    centerX: number,
    centerY: number,
    scale: number,
    reveal: number,
    bootProgress: number,
  ): void {
    if (reveal <= 0) {
      return;
    }
    depthBuffer.fill(-100);
    let litCount = 0;
    const cosineYaw = Math.cos(yaw);
    const sineYaw = Math.sin(yaw);
    const cosinePitch = Math.cos(pitch);
    const sinePitch = Math.sin(pitch);

    for (let offset = 0; offset < modelData.length; offset += 7) {
      const pointX = modelData[offset] ?? 0;
      const pointY = modelData[offset + 1] ?? 0;
      const pointZ = modelData[offset + 2] ?? 0;
      const yawX = pointX * cosineYaw - pointZ * sineYaw;
      const yawZ = pointX * sineYaw + pointZ * cosineYaw;
      const rotatedY = pointY * cosinePitch - yawZ * sinePitch;
      const rotatedZ = pointY * sinePitch + yawZ * cosinePitch;
      const perspective = cameraDistance / (cameraDistance - rotatedZ);
      const column = Math.floor((centerX + yawX * scale * perspective) / cellWidth);
      const row = Math.floor((centerY - rotatedY * scale * perspective) / cellHeight);
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

    const destinationWidth = atlasCellWidth / pixelRatio;
    const destinationHeight = atlasCellHeight / pixelRatio;
    const noiseFrame = Math.floor(timestamp / 48);

    for (let litIndex = 0; litIndex < litCount; litIndex += 1) {
      const index = litCells[litIndex] ?? 0;
      if (cellHash(index, 73) > reveal) {
        continue;
      }
      const column = index % columns;
      const row = Math.floor(index / columns);
      let glyphIndex: number;
      let colorIndex: number;

      if (bootProgress < 1 && cellHash(index, 17) > bootProgress) {
        glyphIndex = Math.floor(cellHash(index + noiseFrame * 97, 29) * glyphRamp.length);
        colorIndex = cellHash(index + noiseFrame * 53, 41) < 0.5 ? 0 : 1;
      } else {
        let light = lightBuffer[index] ?? 0;
        if (pointerSeen) {
          const deltaX = (column + 0.5) * cellWidth - pointerClientX;
          const deltaY = (row + 0.5) * cellHeight - pointerClientY;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          if (distance < glowRadius) {
            light = Math.min(1, light + (1 - distance / glowRadius) * 0.22);
          }
        }
        glyphIndex = Math.min(glyphRamp.length - 1, Math.floor(light * glyphRamp.length));
        colorIndex = Math.min(gruvboxRamp.length - 1, Math.floor(light * gruvboxRamp.length));
      }

      asciiContext.drawImage(
        glyphAtlas,
        glyphIndex * atlasCellWidth,
        colorIndex * atlasCellHeight,
        atlasCellWidth,
        atlasCellHeight,
        column * cellWidth,
        row * cellHeight,
        destinationWidth,
        destinationHeight,
      );
    }
  }

  function renderAsciiModel(timestamp: number): void {
    const homeScale = Math.min(width * 0.25, height * 0.37);
    const markScale = width < 600 ? 30 : 36;
    const markCenterX = (width < 600 ? 12 : clamp(width * 0.03, 16, 40)) + 70;
    const markCenterY = width < 600 ? 44 : 50;
    const centerX = width / 2 + (markCenterX - width / 2) * viewProgress;
    const centerY = height / 2 + (markCenterY - height / 2) * viewProgress;
    const scale = homeScale + (markScale - homeScale) * viewProgress;
    const bootProgress = reducedMotion.matches
      ? 1
      : clamp((timestamp - bootStartedAt) / bootDurationMs, 0, 1);
    const kusaReveal = clamp(1 - viewProgress * 1.25, 0, 1);

    asciiContext.clearRect(0, 0, width, height);
    drawAsciiModel(kusaModelData, timestamp, centerX, centerY, scale, kusaReveal, bootProgress);
  }

  function scheduleFrame(): void {
    if (!framePending) {
      framePending = true;
      window.requestAnimationFrame(renderAsciiFrame);
    }
  }

  function focusView(route: string): void {
    if (route) {
      asciiStage.querySelector<HTMLElement>(`#${route} .section-lede`)?.focus();
      return;
    }
    navLinks[0]?.focus();
  }

  let typeTimer = 0;
  const typeStepMs = 52;

  function setWord(text: string): void {
    if (homeWord) {
      homeWord.textContent = text;
    }
  }

  function typeTo(target: string): void {
    window.clearTimeout(typeTimer);
    if (!homeWord) {
      return;
    }
    if (reducedMotion.matches) {
      setWord(target);
      return;
    }
    const step = (): void => {
      const current = homeWord.textContent ?? "k";
      if (current === target) {
        return;
      }
      const nextLength = current.length < target.length ? current.length + 1 : current.length - 1;
      setWord("kusa".slice(0, Math.max(1, nextLength)));
      typeTimer = window.setTimeout(step, typeStepMs);
    };
    typeTimer = window.setTimeout(step, typeStepMs);
  }

  function playMarkIntro(): void {
    window.clearTimeout(typeTimer);
    if (!homeWord) {
      return;
    }
    if (reducedMotion.matches) {
      setWord("k");
      return;
    }
    const steps = ["ku", "kus", "kusa", "kusa", "kusa", "kusa", "kus", "ku", "k"] as const;
    setWord("k");
    let stepIndex = 0;
    const step = (): void => {
      setWord(steps[stepIndex] ?? "k");
      stepIndex += 1;
      if (stepIndex < steps.length) {
        typeTimer = window.setTimeout(step, typeStepMs);
      }
    };
    typeTimer = window.setTimeout(step, typeStepMs * 3);
  }

  function setView(route: string, animate: boolean, moveFocus: boolean): void {
    const validRoute = routes.includes(route as (typeof routes)[number]) ? route : "";
    asciiStage.dataset.view = validRoute || "home";
    asciiCanvas.setAttribute(
      "aria-label",
      "KUSA rendered as three-dimensional ASCII art that tilts toward the cursor",
    );
    if (validRoute) {
      asciiCanvas.setAttribute("aria-hidden", "true");
    } else {
      asciiCanvas.removeAttribute("aria-hidden");
    }
    if (homeControl) {
      homeControl.tabIndex = validRoute ? 0 : -1;
    }
    if (validRoute && animate && viewProgress < 1) {
      playMarkIntro();
    } else {
      window.clearTimeout(typeTimer);
      setWord("k");
    }
    sections.forEach((section) => {
      section.hidden = section.id !== validRoute;
    });
    navLinks.forEach((link) => {
      if (link.hash === `#${validRoute}`) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    transitionFrom = viewProgress;
    transitionTarget = validRoute ? 1 : 0;
    focusAfterTransition = moveFocus ? validRoute || "home" : "";
    if (reducedMotion.matches || !animate || transitionFrom === transitionTarget) {
      viewProgress = transitionTarget;
      transitionStartedAt = -1;
      scheduleFrame();
      if (moveFocus) {
        focusView(validRoute);
      }
      focusAfterTransition = "";
      return;
    }
    transitionStartedAt = performance.now();
    scheduleFrame();
  }

  function renderAsciiFrame(timestamp: number): void {
    framePending = false;
    if (bootStartedAt < 0) {
      bootStartedAt = timestamp;
    }
    const bootActive = !reducedMotion.matches && timestamp - bootStartedAt < bootDurationMs;
    let transitionActive = false;
    if (transitionStartedAt >= 0) {
      const transitionProgress = clamp(
        (timestamp - transitionStartedAt) / viewTransitionDurationMs,
        0,
        1,
      );
      const easedProgress = transitionProgress * transitionProgress * (3 - 2 * transitionProgress);
      viewProgress = transitionFrom + (transitionTarget - transitionFrom) * easedProgress;
      transitionActive = transitionProgress < 1;
      if (!transitionActive) {
        transitionStartedAt = -1;
        if (focusAfterTransition) {
          focusView(focusAfterTransition === "home" ? "" : focusAfterTransition);
          focusAfterTransition = "";
        }
      }
    }

    let targetYaw: number;
    let targetPitch: number;
    if (reducedMotion.matches || transitionTarget === 1) {
      targetYaw = -0.12;
      targetPitch = -0.03;
    } else if (pointerSeen) {
      targetYaw = pointerX * rotationScalar;
      targetPitch = pointerY * rotationScalar;
    } else if (bootActive) {
      targetYaw = Math.sin(timestamp * autoRotationSpeed) * autoRotationMaxDistance;
      targetPitch = Math.cos(timestamp * autoRotationSpeed) * autoRotationMaxDistance * 0.35;
    } else {
      targetYaw = -0.2;
      targetPitch = -0.07;
    }
    if (reducedMotion.matches) {
      yaw = targetYaw;
      pitch = targetPitch;
      renderAsciiModel(timestamp);
      return;
    }
    const yawDelta = targetYaw - yaw;
    const pitchDelta = targetPitch - pitch;
    const settled =
      !bootActive &&
      !transitionActive &&
      Math.abs(yawDelta) < 0.0005 &&
      Math.abs(pitchDelta) < 0.0005;

    if (settled) {
      yaw = targetYaw;
      pitch = targetPitch;
      renderAsciiModel(timestamp);
      return;
    }

    yaw += yawDelta * 0.35;
    pitch += pitchDelta * 0.35;
    renderAsciiModel(timestamp);
    scheduleFrame();
  }

  window.addEventListener(
    "pointermove",
    (event) => {
      pointerX = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
      pointerY = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
      pointerClientX = event.clientX;
      pointerClientY = event.clientY;
      pointerSeen = true;
      scheduleFrame();
    },
    { passive: true },
  );
  reducedMotion.addEventListener("change", scheduleFrame);

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const route = link.hash.slice(1);
      if (location.hash !== link.hash) {
        history.pushState(null, "", link.hash);
      }
      setView(route, true, true);
    });
  });
  homeControl?.addEventListener("click", (event) => {
    event.preventDefault();
    history.pushState(null, "", `${location.pathname}${location.search}`);
    setView("", true, true);
  });
  const expandMark = (): void => {
    if (asciiStage.dataset.view !== "home") {
      typeTo("kusa");
    }
  };
  const collapseMark = (): void => {
    if (asciiStage.dataset.view !== "home") {
      typeTo("k");
    }
  };
  homeControl?.addEventListener("mouseenter", expandMark);
  homeControl?.addEventListener("mouseleave", collapseMark);
  homeControl?.addEventListener("focus", expandMark);
  homeControl?.addEventListener("blur", collapseMark);
  window.addEventListener("popstate", () => setView(location.hash.slice(1), true, false));
  window.addEventListener("hashchange", () => setView(location.hash.slice(1), true, false));

  const resizeObserver = new ResizeObserver(resizeAsciiCanvas);
  resizeObserver.observe(asciiStage);
  setView(location.hash.slice(1), false, false);
  resizeAsciiCanvas();
}

startKusaAsciiScene();
