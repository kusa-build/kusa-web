const routes = ["about", "values", "posts", "contact"] as const;
const typeStepMs = 52;
const introHoldInitialMs = 1000;
const introHoldWordMs = 5000;
const introHoldEmptyMs = 400;
const loopWords = ["kusa", "automatic"] as const;

function startKusaScene(): void {
  const stage = document.querySelector<HTMLElement>("#kusa-stage");
  const logo = document.querySelector<HTMLAnchorElement>("#kusa-stage .site-logo");
  const word = document.querySelector<HTMLElement>("#kusa-stage .logo-word");
  if (!stage || !logo || !word) {
    return;
  }

  const heroStage = stage;
  const logoWord = word;
  const navLinks = heroStage.querySelectorAll<HTMLAnchorElement>(".site-nav a");
  const sections = heroStage.querySelectorAll<HTMLElement>(".site-section");
  let timer = 0;
  let introPlayed = false;

  function setWord(text: string): void {
    logoWord.textContent = text;
  }

  function typeTo(target: string, done?: () => void): void {
    window.clearTimeout(timer);
    const step = (): void => {
      const current = logoWord.textContent ?? "";
      if (current === target) {
        done?.();
        return;
      }
      setWord(
        target.startsWith(current) ? target.slice(0, current.length + 1) : current.slice(0, -1),
      );
      timer = window.setTimeout(step, typeStepMs);
    };
    timer = window.setTimeout(step, typeStepMs);
  }

  function runLoop(wordIndex: number): void {
    typeTo(loopWords[wordIndex] ?? "kusa", () => {
      timer = window.setTimeout(() => {
        typeTo("", () => {
          timer = window.setTimeout(() => {
            runLoop((wordIndex + 1) % loopWords.length);
          }, introHoldEmptyMs);
        });
      }, introHoldWordMs);
    });
  }

  function playIntro(): void {
    introPlayed = true;
    setWord("k");
    timer = window.setTimeout(() => {
      runLoop(0);
    }, introHoldInitialMs);
  }

  function focusView(route: string): void {
    if (route) {
      heroStage.querySelector<HTMLElement>(`#${route} .section-lede`)?.focus();
      return;
    }
    navLinks[0]?.focus();
  }

  function setView(route: string, moveFocus: boolean): void {
    const validRoute = routes.includes(route as (typeof routes)[number]) ? route : "";
    heroStage.dataset.view = validRoute || "home";
    window.clearTimeout(timer);
    if (validRoute) {
      setWord("k");
    } else if (introPlayed) {
      runLoop(0);
    } else {
      playIntro();
    }
    logo.tabIndex = validRoute ? 0 : -1;
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
    if (moveFocus) {
      focusView(validRoute);
    }
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (location.hash !== link.hash) {
        history.pushState(null, "", link.hash);
      }
      setView(link.hash.slice(1), true);
    });
  });

  logo.addEventListener("click", (event) => {
    event.preventDefault();
    if (heroStage.dataset.view === "home") {
      return;
    }
    history.pushState(null, "", `${location.pathname}${location.search}`);
    setView("", true);
  });

  const expandWord = (): void => {
    if (heroStage.dataset.view !== "home") {
      typeTo("kusa");
    }
  };
  const collapseWord = (): void => {
    if (heroStage.dataset.view !== "home") {
      typeTo("k");
    }
  };
  logo.addEventListener("mouseenter", expandWord);
  logo.addEventListener("mouseleave", collapseWord);
  logo.addEventListener("focus", expandWord);
  logo.addEventListener("blur", collapseWord);

  window.addEventListener("popstate", () => setView(location.hash.slice(1), false));
  window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));

  setView(location.hash.slice(1), false);
}

startKusaScene();
