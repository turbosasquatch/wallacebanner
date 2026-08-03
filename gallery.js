const GALLERY_API = "https://media.streamvaults.co.uk";
const PAGE_SIZE = 18;
const EAGER_COUNT = 6;
const MEDIA_TIMEOUT_MS = 15000;

const album = document.querySelector(".album");
const status = document.querySelector("#gallery-status");
const grid = document.querySelector("#gallery-grid");
const pagination = document.querySelector("#gallery-pagination");
const pageSummary = document.querySelector("#gallery-page-summary");
const pageControls = document.querySelector("#gallery-page-controls");
const viewer = document.querySelector("#media-viewer");
const viewerContent = document.querySelector("#viewer-content");

const pageCache = new Map();
const cursors = new Map([[1, null]]);
let currentPage = 1;
let totalCount = 0;
let isChangingPage = false;
let lastFocusRefresh = Date.now();

function isVideo(item) { return item.contentType.startsWith("video/"); }

function errorNotice(text) {
  const notice = document.createElement("span");
  notice.className = "gallery-card-error";
  notice.textContent = text;
  return notice;
}

function watchMedia(element, cardElement) {
  const timer = window.setTimeout(() => {
    cardElement.classList.add("has-error");
    if (!cardElement.querySelector(".gallery-card-error")) cardElement.append(errorNotice("Preview unavailable · Open original"));
  }, MEDIA_TIMEOUT_MS);
  const finish = (failed = false) => {
    window.clearTimeout(timer);
    if (failed) {
      cardElement.classList.add("has-error");
      if (!cardElement.querySelector(".gallery-card-error")) cardElement.append(errorNotice("Preview unavailable · Open original"));
      return;
    }
    cardElement.classList.remove("has-error");
    cardElement.classList.add("is-loaded");
    cardElement.querySelector(".gallery-card-error")?.remove();
  };
  element.addEventListener("load", () => finish(false), { once: true });
  element.addEventListener("error", () => finish(true), { once: true });
}

function imagePreview(item, eager, cardElement) {
  const image = document.createElement("img");
  image.src = item.variants[800];
  image.srcset = `${item.variants[480]} 480w, ${item.variants[800]} 800w, ${item.variants[1200]} 1200w`;
  image.sizes = "(max-width: 430px) calc(100vw - 2rem), (max-width: 700px) calc(50vw - 1.6rem), min(33vw - 2rem, 352px)";
  image.alt = "Shared celebration moment";
  image.loading = eager ? "eager" : "lazy";
  image.decoding = "async";
  image.fetchPriority = eager ? "high" : "auto";
  watchMedia(image, cardElement);
  return image;
}

function videoPreview(item, eager, cardElement) {
  if (!item.posterUrl) {
    const placeholder = document.createElement("span");
    placeholder.className = "video-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = "▶";
    cardElement.classList.add("is-loaded");
    return placeholder;
  }
  const image = document.createElement("img");
  image.src = item.posterUrl;
  image.alt = "Video preview";
  image.loading = eager ? "eager" : "lazy";
  image.decoding = "async";
  image.fetchPriority = eager ? "high" : "auto";
  watchMedia(image, cardElement);
  return image;
}

function openViewer(item) {
  let element;
  if (isVideo(item)) {
    element = document.createElement("video");
    element.controls = true;
    element.preload = "none";
    element.playsInline = true;
    if (item.posterUrl) element.poster = item.posterUrl;
  } else {
    element = document.createElement("img");
    element.alt = "Shared celebration moment";
    element.decoding = "async";
  }
  element.src = item.originalUrl;
  viewerContent.replaceChildren(element);
  viewer.showModal();
}

function card(item, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery-card";
  button.setAttribute("aria-label", `Open ${isVideo(item) ? "video" : "photo"}`);
  const eager = index < EAGER_COUNT;
  button.append(isVideo(item) ? videoPreview(item, eager, button) : imagePreview(item, eager, button));
  if (isVideo(item)) {
    const label = document.createElement("span");
    label.className = "video-label";
    label.textContent = "Video";
    button.append(label);
  }
  button.addEventListener("click", () => openViewer(item));
  return button;
}

async function getMoments(cursor = null) {
  const endpoint = new URL("/gallery", GALLERY_API);
  if (cursor) endpoint.searchParams.set("cursor", cursor);
  const response = await fetch(endpoint, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("The album could not be loaded. Please try again.");
  return response.json();
}

function pageFromUrl() {
  const value = Number.parseInt(new URL(window.location.href).searchParams.get("page") || "1", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

async function ensurePage(page, { refresh = false } = {}) {
  if (refresh) {
    pageCache.clear();
    cursors.clear();
    cursors.set(1, null);
  }
  if (pageCache.has(page)) return pageCache.get(page);
  for (let number = 1; number <= page; number += 1) {
    if (pageCache.has(number)) continue;
    if (!cursors.has(number)) throw new Error("That gallery page is no longer available.");
    const data = await getMoments(cursors.get(number));
    pageCache.set(number, data);
    if (data.nextCursor) cursors.set(number + 1, data.nextCursor);
    totalCount = Number(data.totalCount || 0);
    if (!data.nextCursor && number < page) throw new Error("That gallery page is no longer available.");
  }
  return pageCache.get(page);
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

function renderPagination(itemCount) {
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstItem = (currentPage - 1) * PAGE_SIZE + 1;
  const lastItem = firstItem + itemCount - 1;
  pageSummary.textContent = `Showing ${firstItem}–${lastItem} of ${totalCount} moments`;
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

function updateUrl(page, replace = false) {
  const url = new URL(window.location.href);
  if (page === 1) url.searchParams.delete("page");
  else url.searchParams.set("page", page);
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

async function showPage(page, { updateHistory = false, replaceHistory = false, moveToGallery = false, refresh = false } = {}) {
  if (isChangingPage) return;
  isChangingPage = true;
  pagination.setAttribute("aria-busy", "true");
  status.classList.remove("is-error");
  status.textContent = `Gathering page ${page}…`;
  try {
    const data = await ensurePage(page, { refresh });
    if (!data.items.length && page === 1) {
      grid.replaceChildren();
      pagination.hidden = true;
      status.textContent = "The album is waiting for its first moment.";
      return;
    }
    currentPage = page;
    grid.replaceChildren(...data.items.map((item, index) => card(item, index)));
    renderPagination(data.items.length);
    status.textContent = "";
    if (updateHistory || replaceHistory) updateUrl(currentPage, replaceHistory);
    if (moveToGallery) {
      album.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      status.focus({ preventScroll: true });
    }
  } catch (error) {
    status.classList.add("is-error");
    status.textContent = error.message;
  } finally {
    pagination.removeAttribute("aria-busy");
    isChangingPage = false;
  }
}

pageControls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-page]");
  if (!button || button.disabled) return;
  showPage(Number(button.dataset.page), { updateHistory: true, moveToGallery: true });
});
window.addEventListener("popstate", () => showPage(pageFromUrl(), { moveToGallery: true }));
window.addEventListener("focus", () => {
  if (currentPage !== 1 || Date.now() - lastFocusRefresh < 15000) return;
  lastFocusRefresh = Date.now();
  showPage(1, { refresh: true, replaceHistory: currentPage !== 1 });
});
document.querySelector("#close-viewer").addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (event) => { if (event.target === viewer) viewer.close(); });
viewer.addEventListener("close", () => viewerContent.replaceChildren());
showPage(pageFromUrl(), { replaceHistory: false });
