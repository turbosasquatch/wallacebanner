const GALLERY_API = "https://claire-george-party-uploads.claire-george-wedding-2026.workers.dev";
const PAGE_SIZE = 30;

const album = document.querySelector(".album");
const status = document.querySelector("#gallery-status");
const grid = document.querySelector("#gallery-grid");
const pagination = document.querySelector("#gallery-pagination");
const pageSummary = document.querySelector("#gallery-page-summary");
const pageControls = document.querySelector("#gallery-page-controls");
const viewer = document.querySelector("#media-viewer");
const viewerContent = document.querySelector("#viewer-content");
let moments = [];
let currentPage = 1;
let isChangingPage = false;

function isVideo(item) { return item.contentType.startsWith("video/"); }

function mediaElement(item, { controls = false, eager = false } = {}) {
  const element = document.createElement(isVideo(item) ? "video" : "img");
  element.src = item.url;
  if (isVideo(item)) {
    element.controls = controls;
    element.preload = eager ? "metadata" : "none";
    element.playsInline = true;
    element.muted = !controls;
  } else {
    element.alt = "Shared celebration moment";
    element.loading = eager ? "eager" : "lazy";
    element.decoding = "async";
  }
  return element;
}

function openViewer(item) {
  viewerContent.replaceChildren(mediaElement(item, { controls: true, eager: true }));
  viewer.showModal();
}

function card(item, { eager = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery-card";
  button.setAttribute("aria-label", `Open ${isVideo(item) ? "video" : "photo"}`);
  button.append(mediaElement(item, { eager }));
  if (isVideo(item)) {
    const label = document.createElement("span");
    label.className = "video-label";
    label.textContent = "Video";
    button.append(label);
  }
  button.addEventListener("click", () => openViewer(item));
  return button;
}

function mediaReady(element) {
  if (element instanceof HTMLImageElement) {
    return element.decode ? element.decode().catch(() => {}) : Promise.resolve();
  }
  if (element.readyState >= 1) return Promise.resolve();
  element.load();
  return Promise.race([
    new Promise((resolve) => {
      element.addEventListener("loadedmetadata", resolve, { once: true });
      element.addEventListener("error", resolve, { once: true });
    }),
    new Promise((resolve) => window.setTimeout(resolve, 8000))
  ]);
}

async function getMoments(cursor = null) {
  const endpoint = new URL("/gallery", GALLERY_API);
  if (cursor) endpoint.searchParams.set("cursor", cursor);
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("The album could not be loaded.");
  return response.json();
}

async function getAllMoments() {
  const itemsById = new Map();
  const seenCursors = new Set();
  let cursor = null;
  do {
    const data = await getMoments(cursor);
    data.items.forEach((item) => {
      if (item.id && !itemsById.has(item.id)) itemsById.set(item.id, item);
    });
    if (!data.nextCursor) break;
    if (seenCursors.has(data.nextCursor)) throw new Error("The album could not be loaded.");
    seenCursors.add(data.nextCursor);
    cursor = data.nextCursor;
  } while (cursor);
  return [...itemsById.values()].sort((a, b) => {
    const timeDifference = Date.parse(b.uploadedAt || 0) - Date.parse(a.uploadedAt || 0);
    return timeDifference || b.id.localeCompare(a.id);
  });
}

function pageFromUrl() {
  const value = Number.parseInt(new URL(window.location.href).searchParams.get("page") || "1", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function pageTokens(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 4) [2, 3, 4, 5].forEach((value) => pages.add(value));
  if (page >= pageCount - 3) [pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1].forEach((value) => pages.add(value));
  const sorted = [...pages].filter((value) => value > 0 && value <= pageCount).sort((a, b) => a - b);
  return sorted.flatMap((value, index) => index && value - sorted[index - 1] > 1 ? ["ellipsis", value] : [value]);
}

function arrow(direction) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 12");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", direction === "previous" ? "M31 6H1m0 0 5-5M1 6l5 5" : "M1 6h30m0 0-5-5m5 5-5 5");
  svg.append(path);
  return svg;
}

function actionButton(label, targetPage, direction, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery-page-action";
  button.dataset.page = targetPage;
  button.disabled = disabled;
  if (direction === "previous") button.append(arrow(direction));
  button.append(document.createTextNode(label));
  if (direction === "next") button.append(arrow(direction));
  return button;
}

function renderPagination() {
  const pageCount = Math.ceil(moments.length / PAGE_SIZE);
  const firstItem = (currentPage - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(currentPage * PAGE_SIZE, moments.length);
  pageSummary.textContent = `Showing ${firstItem}–${lastItem} of ${moments.length} moments`;

  const pageList = document.createElement("span");
  pageList.className = "gallery-page-list";
  pageTokens(currentPage, pageCount).forEach((token) => {
    if (token === "ellipsis") {
      const ellipsis = document.createElement("span");
      ellipsis.className = "gallery-page-ellipsis";
      ellipsis.textContent = "…";
      ellipsis.setAttribute("aria-hidden", "true");
      pageList.append(ellipsis);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-page-number";
    button.dataset.page = token;
    button.textContent = token;
    button.setAttribute("aria-label", `Page ${token}`);
    if (token === currentPage) {
      button.setAttribute("aria-current", "page");
      button.disabled = true;
    }
    pageList.append(button);
  });

  const mobilePage = document.createElement("span");
  mobilePage.className = "gallery-page-mobile";
  mobilePage.textContent = `${currentPage} / ${pageCount}`;
  mobilePage.setAttribute("aria-hidden", "true");
  pageControls.replaceChildren(
    actionButton("Previous", currentPage - 1, "previous", currentPage === 1),
    pageList,
    mobilePage,
    actionButton("Next", currentPage + 1, "next", currentPage === pageCount)
  );
  pagination.hidden = pageCount <= 1;
}

function updateUrl(page, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (page === 1) url.searchParams.delete("page");
  else url.searchParams.set("page", page);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

async function showPage(page, { updateHistory = false, replaceHistory = false, moveToGallery = false } = {}) {
  if (isChangingPage || !moments.length) return;
  const pageCount = Math.ceil(moments.length / PAGE_SIZE);
  const nextPage = Math.min(Math.max(page, 1), pageCount);
  isChangingPage = true;
  pagination.setAttribute("aria-busy", "true");
  status.textContent = `Gathering page ${nextPage}…`;
  const pageItems = moments.slice((nextPage - 1) * PAGE_SIZE, nextPage * PAGE_SIZE);
  const cards = pageItems.map((item) => card(item, { eager: true }));
  await Promise.all(cards.map((element) => mediaReady(element.querySelector("img, video"))));
  grid.replaceChildren(...cards);
  currentPage = nextPage;
  renderPagination();
  pagination.removeAttribute("aria-busy");
  status.classList.remove("is-error");
  status.textContent = "";
  if (updateHistory || replaceHistory) updateUrl(currentPage, { replace: replaceHistory });
  isChangingPage = false;
  if (moveToGallery) {
    album.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    status.focus({ preventScroll: true });
  }
}

async function loadGallery() {
  try {
    moments = await getAllMoments();
    if (!moments.length) {
      status.textContent = "The album is waiting for its first moment.";
      return;
    }
    const requestedPage = pageFromUrl();
    const pageCount = Math.ceil(moments.length / PAGE_SIZE);
    await showPage(Math.min(requestedPage, pageCount), { replaceHistory: requestedPage > pageCount });
  } catch (error) {
    status.classList.add("is-error");
    status.textContent = error.message;
  }
}

pageControls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-page]");
  if (!button || button.disabled) return;
  showPage(Number(button.dataset.page), { updateHistory: true, moveToGallery: true });
});
window.addEventListener("popstate", () => showPage(pageFromUrl(), { moveToGallery: true }));
document.querySelector("#close-viewer").addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (event) => { if (event.target === viewer) viewer.close(); });
viewer.addEventListener("close", () => viewerContent.replaceChildren());
loadGallery();
