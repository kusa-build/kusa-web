type WordCell = {
  readonly dx: number;
  readonly dy: number;
  readonly weight: number;
  readonly green: boolean;
  readonly cursor: boolean;
};

const glyphRamp = [".", ":", "-", "+", "*", "=", "%", "@", "#", "&"] as const;
const bootDurationMs = 900;
const viewTransitionDurationMs = 560;
const routes = ["purpose", "values", "posts", "contact"] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function cellHash(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
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
  const homeControl = asciiStage.querySelector<HTMLAnchorElement>(".ascii-home");
  const homeWord = asciiStage.querySelector<HTMLElement>(".ascii-home .home-word");
  const navLinks = asciiStage.querySelectorAll<HTMLAnchorElement>(".ascii-nav a");
  const sections = asciiStage.querySelectorAll<HTMLElement>(".site-section");
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let cellWidth = 6.8;
  let cellHeight = 11.9;
  let fontSize = 11;
  let wordCells: ReadonlyArray<WordCell> = [];
  let framePending = false;
  let bootStartedAt = -1;
  let cursorOn = true;
  let blinkTimer = 0;
  let viewProgress = routes.includes(location.hash.slice(1) as (typeof routes)[number]) ? 1 : 0;
  let transitionFrom = viewProgress;
  let transitionTarget = viewProgress;
  let transitionStartedAt = -1;
  let focusAfterTransition = "";

  function buildWordModel(): void {
    const wordWidth =
      width < 700 ? width * 0.94 : Math.min(width * 0.72, 1_100);
    fontSize = wordWidth < 560 ? 6 : wordWidth < 860 ? 9 : 11;
    cellWidth = fontSize * 0.62;
    cellHeight = fontSize * 1.08;

    const sampleCanvas = document.createElement("canvas");
    const sampleHeight = Math.round(wordWidth * 0.3);
    sampleCanvas.width = Math.round(wordWidth);
    sampleCanvas.height = sampleHeight;
    const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) {
      return;
    }

    const sampleFontSize = sampleHeight * 0.74;
    sampleContext.font = `700 ${sampleFontSize}px SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    sampleContext.textBaseline = "alphabetic";
    const characterWidth = sampleContext.measureText("k").width;
    const xHeight = sampleFontSize * 0.52;
    const ascent = sampleFontSize * 0.74;
    const chevronWidth = characterWidth * 0.58;
    const chevronGap = characterWidth * 0.12;
    const cursorWidth = characterWidth * 0.5;
    const cursorGap = characterWidth * 0.14;
    const totalWidth = chevronWidth + chevronGap + characterWidth * 4 + cursorGap + cursorWidth;
    const startX = (sampleCanvas.width - totalWidth) / 2;
    const baseline = sampleHeight * 0.78;
    const strokeWidth = sampleFontSize * 0.11;

    sampleContext.strokeStyle = "#0f0";
    sampleContext.lineWidth = strokeWidth;
    sampleContext.lineJoin = "miter";
    sampleContext.beginPath();
    sampleContext.moveTo(startX + strokeWidth / 2, baseline - xHeight + strokeWidth / 2);
    sampleContext.lineTo(startX + chevronWidth - strokeWidth / 2, baseline - xHeight / 2);
    sampleContext.lineTo(startX + strokeWidth / 2, baseline - strokeWidth / 2);
    sampleContext.stroke();
    sampleContext.fillStyle = "#fff";
    sampleContext.fillText("kusa", startX + chevronWidth + chevronGap, baseline);
    sampleContext.fillStyle = "#0f0";
    sampleContext.fillRect(
      startX + chevronWidth + chevronGap + characterWidth * 4 + cursorGap,
      baseline - ascent,
      cursorWidth,
      ascent + sampleFontSize * 0.09,
    );

    const pixels = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleHeight).data;
    const modelColumns = Math.ceil(sampleCanvas.width / cellWidth);
    const modelRows = Math.ceil(sampleHeight / cellHeight);
    const cells: Array<{
      column: number;
      row: number;
      weight: number;
      green: boolean;
      cursor: boolean;
    }> = [];

    for (let row = 0; row < modelRows; row += 1) {
      for (let column = 0; column < modelColumns; column += 1) {
        let hits = 0;
        let greenHits = 0;
        let samples = 0;
        for (let subY = 0; subY < 3; subY += 1) {
          for (let subX = 0; subX < 2; subX += 1) {
            const sampleX = Math.min(
              sampleCanvas.width - 1,
              Math.round(column * cellWidth + (subX * cellWidth) / 2 + 1),
            );
            const sampleY = Math.min(
              sampleHeight - 1,
              Math.round(row * cellHeight + (subY * cellHeight) / 3 + 1),
            );
            const pixelOffset = (sampleY * sampleCanvas.width + sampleX) * 4;
            if ((pixels[pixelOffset + 3] ?? 0) > 100) {
              hits += 1;
              if ((pixels[pixelOffset + 1] ?? 0) > 200 && (pixels[pixelOffset] ?? 0) < 100) {
                greenHits += 1;
              }
            }
            samples += 1;
          }
        }
        if (hits / samples > 0.3) {
          cells.push({
            column,
            row,
            weight: hits / samples,
            green: greenHits > hits / 2,
            cursor: false,
          });
        }
      }
    }

    let maxGreenColumn = 0;
    for (const cell of cells) {
      if (cell.green && cell.column > maxGreenColumn) {
        maxGreenColumn = cell.column;
      }
    }
    const cursorColumns = Math.ceil(cursorWidth / cellWidth) + 1;
    for (const cell of cells) {
      if (cell.green && cell.column > maxGreenColumn - cursorColumns) {
        cell.cursor = true;
      }
    }

    wordCells = cells.map((cell) => ({
      dx: cell.column + 0.5 - modelColumns / 2,
      dy: cell.row + 0.5 - modelRows / 2,
      weight: cell.weight,
      green: cell.green,
      cursor: cell.cursor,
    }));
  }

  function resizeAsciiCanvas(): void {
    const bounds = asciiStage.getBoundingClientRect();
    width = Math.max(320, Math.round(bounds.width));
    height = Math.max(420, Math.round(bounds.height));
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    asciiCanvas.width = Math.round(width * pixelRatio);
    asciiCanvas.height = Math.round(height * pixelRatio);
    asciiCanvas.style.width = `${width}px`;
    asciiCanvas.style.height = `${height}px`;
    asciiContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    buildWordModel();
    scheduleFrame();
  }

  function renderAsciiModel(timestamp: number): void {
    asciiContext.clearRect(0, 0, width, height);
    const reveal = clamp(1 - viewProgress * 1.25, 0, 1);
    if (reveal <= 0 || wordCells.length === 0) {
      return;
    }

    const markCenterX = (width < 600 ? 12 : clamp(width * 0.03, 16, 40)) + 70;
    const markCenterY = width < 600 ? 44 : 50;
    const centerX = width / 2 + (markCenterX - width / 2) * viewProgress;
    const centerY = height / 2 + (markCenterY - height / 2) * viewProgress;
    const scale = 1 + (0.08 - 1) * viewProgress;
    const bootProgress = reducedMotion.matches
      ? 1
      : clamp((timestamp - bootStartedAt) / bootDurationMs, 0, 1);
    const noiseFrame = Math.floor(timestamp / 48);

    asciiContext.font = `600 ${Math.max(4, fontSize * scale)}px SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    asciiContext.textBaseline = "top";

    for (let cellIndex = 0; cellIndex < wordCells.length; cellIndex += 1) {
      const cell = wordCells[cellIndex];
      if (!cell) {
        continue;
      }
      if (cellHash(cellIndex, 73) > reveal) {
        continue;
      }
      let glyph: string;
      let color: string;
      if (bootProgress < 1 && cellHash(cellIndex, 17) > bootProgress) {
        glyph =
          glyphRamp[Math.floor(cellHash(cellIndex + noiseFrame * 97, 29) * glyphRamp.length)] ??
          ".";
        color = cellHash(cellIndex + noiseFrame * 53, 41) < 0.5 ? "#504945" : "#7c6f64";
      } else {
        if (cell.cursor && !cursorOn) {
          continue;
        }
        const density = Math.min(0.999, 0.6 + cell.weight * 0.4);
        glyph = glyphRamp[Math.floor(density * glyphRamp.length)] ?? "&";
        color = cell.green ? "#b8bb26" : cell.weight > 0.55 ? "#ebdbb2" : "#d5c4a1";
      }
      asciiContext.fillStyle = color;
      asciiContext.fillText(
        glyph,
        centerX + cell.dx * cellWidth * scale - (cellWidth * scale) / 2,
        centerY + cell.dy * cellHeight * scale - (cellHeight * scale) / 2,
      );
    }
  }

  function scheduleFrame(): void {
    if (!framePending) {
      framePending = true;
      window.requestAnimationFrame(renderAsciiFrame);
    }
  }

  function stopCursorBlink(): void {
    window.clearTimeout(blinkTimer);
    blinkTimer = 0;
    cursorOn = true;
  }

  function blinkTick(): void {
    cursorOn = !cursorOn;
    scheduleFrame();
    blinkTimer = window.setTimeout(blinkTick, cursorOn ? 700 : 450);
  }

  function startCursorBlink(): void {
    if (blinkTimer !== 0 || reducedMotion.matches || document.hidden) {
      return;
    }
    blinkTimer = window.setTimeout(blinkTick, 700);
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
    if (validRoute) {
      asciiCanvas.setAttribute("aria-hidden", "true");
      stopCursorBlink();
    } else {
      asciiCanvas.removeAttribute("aria-hidden");
      startCursorBlink();
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

    renderAsciiModel(timestamp);
    if (bootActive || transitionActive) {
      scheduleFrame();
    }
  }

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      stopCursorBlink();
    } else if (asciiStage.dataset.view === "home") {
      startCursorBlink();
    }
    scheduleFrame();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopCursorBlink();
    } else if (asciiStage.dataset.view === "home") {
      startCursorBlink();
      scheduleFrame();
    }
  });

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
