const GALLERY_API = "https://claire-george-party-uploads.claire-george-wedding-2026.workers.dev";

const status = document.querySelector("#gallery-status");
const grid = document.querySelector("#gallery-grid");
const loadMore = document.querySelector("#load-more");
const viewer = document.querySelector("#media-viewer");
const viewerContent = document.querySelector("#viewer-content");
let nextCursor = null;
const renderedIds = new Set();

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

function card(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery-card";
  button.setAttribute("aria-label", `Open ${isVideo(item) ? "video" : "photo"}`);
  button.append(mediaElement(item));
  if (isVideo(item)) {
    const label = document.createElement("span");
    label.className = "video-label";
    label.textContent = "Video";
    button.append(label);
  }
  button.addEventListener("click", () => openViewer(item));
  return button;
}

function render(items) {
  const newItems = items.filter((item) => {
    if (!item.id || renderedIds.has(item.id)) return false;
    renderedIds.add(item.id);
    return true;
  });
  grid.append(...newItems.map((item) => card(item)));
}

async function getMoments(cursor = null) {
  const endpoint = new URL("/gallery", GALLERY_API);
  if (cursor) endpoint.searchParams.set("cursor", cursor);
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("The album could not be loaded.");
  return response.json();
}

async function loadMoments({ more = false } = {}) {
  loadMore.disabled = true;
  if (!more) status.textContent = "Gathering the moments…";
  try {
    const data = await getMoments(more ? nextCursor : null);
    render(data.items);
    nextCursor = data.nextCursor;
    loadMore.hidden = !nextCursor;
    status.classList.remove("is-error");
    status.textContent = grid.childElementCount ? "" : "The album is waiting for its first moment.";
  } catch (error) {
    status.classList.add("is-error");
    status.textContent = error.message;
  } finally {
    loadMore.disabled = false;
  }
}

loadMore.addEventListener("click", () => loadMoments({ more: true }));
document.querySelector("#close-viewer").addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (event) => { if (event.target === viewer) viewer.close(); });
viewer.addEventListener("close", () => viewerContent.replaceChildren());
loadMoments();
