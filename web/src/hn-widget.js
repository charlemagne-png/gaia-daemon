/**
 * @fileoverview Hacker News Carousel Widget — Phase 1 sidebar component.
 *
 * CAROUSEL SHELL: N-slide carousel with dot/arrow navigation.
 * Shipping ONE slide (HN); extensible for future slides via clean registration seam.
 *
 * HN SLIDE: Fetches top stories via HN Algolia API, displays title/points/comments/age.
 * Links open in new window (never navigate app). Refreshes every 5min with offline cache fallback.
 *
 * VOICE SEAM: `setVoiceMode(handle, on)` swaps carousel ↔ hermes placeholder panel.
 *
 * DESIGN: Restrained Apple language — content-first, hairlines, no orange branding blocks.
 * Muted HN accent chip only.
 *
 * @typedef {Object} CarouselHandle
 * @property {Function} destroy
 *
 * @typedef {Object} CarouselOptions
 * @property {string} [theme='apple'] - Theme name for CSS scoping
 *
 * @typedef {Object} HNStory
 * @property {string} title
 * @property {number} points
 * @property {number} num_comments
 * @property {number} created_at_i - Unix timestamp
 * @property {string} url
 * @property {string} story_id
 */

// Hyperscript helper (inline for no-import pattern)
/** @param {string} tag @param {object} [attrs] @param {...*} children @returns {HTMLElement} */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else if (key === "value") node.value = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Format timestamp to human-readable relative age
/** @param {number} unixTimestamp @returns {string} */
function formatAge(unixTimestamp) {
  const now = Date.now() / 1000;
  const age = now - unixTimestamp;

  if (age < 60) return "now";
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  if (age < 604800) return `${Math.floor(age / 86400)}d ago`;
  return `${Math.floor(age / 604800)}w ago`;
}

// Local storage keys for caching
const CACHE_KEY_STORIES = "hn-widget-stories-cache";
const CACHE_KEY_TIMESTAMP = "hn-widget-cache-timestamp";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch top HN stories from Algolia API.
 * Returns top 5 stories as tile rows within one carousel slide.
 * Falls back to cached results if network fails.
 * @returns {Promise<Array<HNStory>>}
 */
async function fetchHNStories() {
  try {
    const response = await fetch(
      "https://hn.algolia.com/api/v1/search?tags=front_page",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const stories = (data.hits || []).slice(0, 5); // Top 5 stories as tile rows

    // Cache successful fetch
    try {
      localStorage.setItem(CACHE_KEY_STORIES, JSON.stringify(stories));
      localStorage.setItem(CACHE_KEY_TIMESTAMP, String(Date.now()));
    } catch (e) {
      console.warn("Failed to cache stories:", e.message);
    }

    return stories;
  } catch (error) {
    console.warn("HN fetch failed, attempting cache fallback:", error.message);

    // Graceful offline fallback: return cached stories if available
    try {
      const cached = localStorage.getItem(CACHE_KEY_STORIES);
      if (cached) {
        console.log("Using cached HN stories");
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn("Cache fallback failed:", e.message);
    }

    // Last resort: placeholder story
    return [
      {
        title: "Hacker News",
        points: 0,
        num_comments: 0,
        created_at_i: Math.floor(Date.now() / 1000),
        url: "https://news.ycombinator.com",
        story_id: "0",
      },
    ];
  }
}

/**
 * Render a single HN story as a tile row.
 * FORM: avatar-first structure → source chip + title/meta stack → click opens story.
 * @param {HNStory} story
 * @returns {HTMLElement}
 */
function renderHNStory(story) {
  const tile = h(
    "a",
    {
      class: "hn-widget-tile",
      href: story.url || "https://news.ycombinator.com",
      target: "_blank",
      rel: "noopener noreferrer",
    }
  );

  // Avatar-first: source indicator (HN muted accent chip)
  const avatar = h("div", { class: "hn-widget-avatar" }, "HN");

  // Content stack: title + metadata row
  const content = h("div", { class: "hn-widget-content" });

  const title = h("div", { class: "hn-widget-title", text: story.title });

  const meta = h("div", { class: "hn-widget-meta" });
  const points = h("span", { class: "hn-widget-stat", text: `${story.points || 0} points` });
  const comments = h("span", { class: "hn-widget-stat", text: `${story.num_comments || 0}` });
  const age = h("span", { class: "hn-widget-stat", text: formatAge(story.created_at_i) });

  meta.append(points, h("span", { class: "hn-widget-separator", text: "·" }), comments, h("span", { class: "hn-widget-separator", text: "·" }), age);

  content.append(title, meta);
  tile.append(avatar, content);

  return tile;
}

/**
 * Create carousel shell with slide container + navigation affordances.
 * Extensible for N slides; currently ships ONE.
 * @param {HTMLElement} container
 * @returns {{ container: HTMLElement, addSlide: Function, currentIndex: number }}
 */
function createCarouselShell(container) {
  const carousel = h("div", { class: "hn-widget-carousel" });
  const slideContainer = h("div", { class: "hn-widget-slides" });
  const dotsContainer = h("div", { class: "hn-widget-dots" });
  const navLeft = h("button", { class: "hn-widget-nav hn-widget-nav-left", "aria-label": "Previous slide" }, "‹");
  const navRight = h("button", { class: "hn-widget-nav hn-widget-nav-right", "aria-label": "Next slide" }, "›");

  let currentIndex = 0;
  const slides = [];

  /**
   * Add a slide to the carousel.
   * @param {HTMLElement} slideEl
   * @returns {void}
   */
  function addSlide(slideEl) {
    slideEl.classList.add("hn-widget-slide");
    if (slides.length === 0) slideEl.classList.add("active");
    slides.push(slideEl);

    // Create dot
    const dot = h("button", { class: "hn-widget-dot-nav" });
    if (slides.length - 1 === 0) dot.classList.add("active");
    dot.addEventListener("click", () => goToSlide(slides.length - 1));
    dotsContainer.append(dot);

    slideContainer.append(slideEl);
  }

  /**
   * Navigate to specific slide index.
   * @param {number} idx
   * @returns {void}
   */
  function goToSlide(idx) {
    if (idx < 0 || idx >= slides.length) return;
    slides[currentIndex]?.classList.remove("active");
    slides[idx]?.classList.add("active");
    document.querySelectorAll(".hn-widget-dot-nav").forEach((dot, i) => {
      if (i === idx) dot.classList.add("active");
      else dot.classList.remove("active");
    });
    currentIndex = idx;
  }

  // Navigation handlers
  navLeft.addEventListener("click", () => goToSlide(currentIndex - 1));
  navRight.addEventListener("click", () => goToSlide(currentIndex + 1));

  carousel.append(navLeft, slideContainer, navRight);
  // Only show dots for multi-slide carousels; hide nav for single slide
  if (slides.length > 1) {
    carousel.append(dotsContainer);
    navLeft.style.display = "flex";
    navRight.style.display = "flex";
  } else {
    navLeft.style.display = "none";
    navRight.style.display = "none";
  }

  container.append(carousel);

  return { container: slideContainer, addSlide, get currentIndex() { return currentIndex; } };
}

/**
 * Mount HN Carousel widget into element.
 *
 * SEAM: Next phases can register additional slides via addSlide().
 *
 * @param {HTMLElement} el - Mount target
 * @param {CarouselOptions} [opts={}]
 * @returns {CarouselHandle}
 */
export async function mountHnCarousel(el, opts = {}) {
  const theme = opts.theme || "apple";

  // Create widget container
  const widgetContainer = h("div", {
    class: "hn-widget",
    "data-theme": theme,
  });

  // Create carousel shell
  const { addSlide, currentIndex } = createCarouselShell(widgetContainer);

  // Fetch and render HN stories
  let stories = [];
  let refreshTimer = null;
  let currentVoiceMode = false;
  let voicePanel = null;

  /**
   * Render HN slide with all stories as tile rows.
   * @returns {void}
   */
  async function renderHNSlide() {
    stories = await fetchHNStories();

    // Create slide container with tile rows stacked
    const slide = h("div", { class: "hn-widget-hn-slide" });

    if (stories.length === 0) {
      slide.append(
        h("div", { class: "hn-widget-empty", text: "No stories available" })
      );
    } else {
      // Render each story as a tile row
      stories.forEach((story) => {
        slide.append(renderHNStory(story));
      });
    }

    // Clear existing slides and re-add
    const slideContainer = widgetContainer.querySelector(".hn-widget-slides");
    if (slideContainer) slideContainer.innerHTML = "";

    addSlide(slide);
  }

  /**
   * Schedule refresh every 5 minutes.
   * @returns {void}
   */
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      await renderHNSlide();
      scheduleRefresh();
    }, 5 * 60 * 1000);
  }

  // Initial render
  await renderHNSlide();
  scheduleRefresh();

  // Mount to DOM
  el.append(widgetContainer);

  return {
    destroy() {
      if (refreshTimer) clearTimeout(refreshTimer);
      widgetContainer.remove();
    },
  };
}

/**
 * Voice Mode Seam: Toggle carousel ↔ hermes placeholder.
 *
 * When voice ON: Replace carousel with `.hn-widget-hermes-slot` div (branded placeholder,
 * actual hermes UI wired in Phase 2).
 *
 * When voice OFF: Restore carousel.
 *
 * @param {CarouselHandle} handle - Widget handle from mountHnCarousel()
 * @param {boolean} on - True for voice mode, false for carousel
 * @returns {void}
 */
export function setVoiceMode(handle, on) {
  // NOTE: This seam expects handle to carry a reference to the carousel container.
  // For now, we locate the carousel in the DOM via class selector.
  // Phase 2: integrate with actual hermes UI panel.

  const widgetContainer = document.querySelector(".hn-widget");
  if (!widgetContainer) return;

  const carousel = widgetContainer.querySelector(".hn-widget-carousel");
  let voicePanel = widgetContainer.querySelector(".hn-widget-hermes-slot");

  if (on) {
    // Hide carousel, show voice panel
    if (carousel) carousel.style.display = "none";

    // Create voice panel if not exists
    if (!voicePanel) {
      voicePanel = h("div", { class: "hn-widget-hermes-slot" });
      // Placeholder branded content (Phase 2 wires actual hermes UI here)
      voicePanel.innerHTML = '<div class="hn-widget-hermes-placeholder">Hermes Active</div>';
      widgetContainer.append(voicePanel);
    } else {
      voicePanel.style.display = "flex";
    }
  } else {
    // Show carousel, hide voice panel
    if (carousel) carousel.style.display = "flex";
    if (voicePanel) voicePanel.style.display = "none";
  }
}
