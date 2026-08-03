const UPLOAD_API = "https://media.streamvaults.co.uk";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const POSTER_MAX_WIDTH = 640;
const POSTER_QUALITY = 0.76;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

const form = document.querySelector("#upload-form");
const eventCode = document.querySelector("#event-code");
const uploaderName = document.querySelector("#uploader-name");
const picker = document.querySelector("#file-picker");
const chooseFiles = document.querySelector("#choose-files");
const uploadAll = document.querySelector("#upload-all");
const queue = document.querySelector("#upload-queue");
const message = document.querySelector("#form-message");
const galleryLink = document.querySelector("#uploaded-gallery-link");
let items = [];
let isUploading = false;

const formatBytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
const isVideoFile = (file) => ALLOWED_VIDEO_TYPES.has(file.type);

function setMessage(text = "", success = false) {
  message.textContent = text;
  message.classList.toggle("is-success", success);
}

function removeItem(id) {
  const item = items.find((candidate) => candidate.id === id);
  if (item?.preview) URL.revokeObjectURL(item.preview);
  items = items.filter((candidate) => candidate.id !== id);
  renderQueue();
}

function stateText(item) {
  if (item.state === "complete") return "Upload complete";
  if (item.state === "preparing") return "Preparing a lightweight preview…";
  if (item.state === "reserving") return "Checking free gallery capacity…";
  if (item.state === "uploading") return `Uploading ${item.progress}%`;
  if (item.state === "publishing") return "Adding to the album…";
  return item.error || "Ready to upload";
}

function renderQueue() {
  queue.replaceChildren();
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "upload-card";
    const preview = document.createElement(item.file.type.startsWith("video/") ? "video" : "img");
    preview.className = "upload-card-preview";
    preview.src = item.preview;
    preview.alt = "";
    if (preview.tagName === "VIDEO") {
      preview.muted = true;
      preview.preload = "metadata";
    }
    const copy = document.createElement("div");
    copy.className = "upload-card-copy";
    const name = document.createElement("p");
    name.className = "upload-card-name";
    name.textContent = item.file.name;
    const size = document.createElement("p");
    size.className = "upload-card-size";
    size.textContent = formatBytes(item.file.size);
    const state = document.createElement("p");
    state.className = "upload-card-state";
    state.textContent = stateText(item);
    if (item.state === "error") state.classList.add("is-error");
    copy.append(name, size, state);
    if (["uploading", "publishing"].includes(item.state)) {
      const progress = document.createElement("div");
      progress.className = "upload-progress";
      const bar = document.createElement("span");
      bar.style.width = `${item.state === "publishing" ? 100 : item.progress}%`;
      progress.append(bar);
      copy.append(progress);
    }
    const action = document.createElement("button");
    action.type = "button";
    action.className = "upload-card-action";
    if (item.state === "complete") {
      action.classList.add("is-complete");
      action.setAttribute("aria-label", `${item.file.name} uploaded`);
      action.disabled = true;
    } else if (["preparing", "reserving", "uploading", "publishing"].includes(item.state)) {
      action.textContent = "…";
      action.disabled = true;
      action.setAttribute("aria-label", `${item.file.name} uploading`);
    } else {
      const removeIcon = document.createElement("img");
      removeIcon.src = "assets/photos/remove-icon.png";
      removeIcon.alt = "";
      removeIcon.width = 24;
      removeIcon.height = 24;
      action.setAttribute("aria-label", `Remove ${item.file.name}`);
      action.append(removeIcon);
      action.addEventListener("click", () => removeItem(item.id));
    }
    card.append(preview, copy, action);
    queue.append(card);
  });
  uploadAll.hidden = items.length === 0;
  uploadAll.disabled = isUploading;
  uploadAll.textContent = isUploading ? "Uploading selected files…" : "Upload selected files";
}

function validateFiles(files) {
  const invalid = files.find((file) => {
    if (ALLOWED_IMAGE_TYPES.has(file.type)) return file.size > MAX_IMAGE_BYTES;
    if (ALLOWED_VIDEO_TYPES.has(file.type)) return file.size > MAX_VIDEO_BYTES;
    return true;
  });
  if (!invalid) return "";
  if (ALLOWED_IMAGE_TYPES.has(invalid.type) && invalid.size > MAX_IMAGE_BYTES) return `${invalid.name} is larger than the 20 MB photo limit.`;
  if (ALLOWED_VIDEO_TYPES.has(invalid.type) && invalid.size > MAX_VIDEO_BYTES) return `${invalid.name} is larger than the 25 MB video limit.`;
  return `${invalid.name} is not a supported photo or video.`;
}

chooseFiles.addEventListener("click", () => picker.click());

picker.addEventListener("change", () => {
  const files = Array.from(picker.files || []);
  const error = validateFiles(files);
  if (error) {
    setMessage(error);
    picker.value = "";
    return;
  }
  items.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
  items = files.map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), state: "ready", progress: 0 }));
  galleryLink.hidden = true;
  setMessage(files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected.` : "", true);
  renderQueue();
});

function waitFor(element, successEvent, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Preview timed out.")), timeoutMs);
    element.addEventListener(successEvent, () => { window.clearTimeout(timer); resolve(); }, { once: true });
    element.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("Preview unavailable.")); }, { once: true });
  });
}

async function createVideoPoster(file) {
  const source = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = source;
  try {
    await waitFor(video, "loadedmetadata");
    video.currentTime = Math.min(Math.max(video.duration * 0.1, 0.1), 1);
    await waitFor(video, "seeked");
    const scale = Math.min(1, POSTER_MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", POSTER_QUALITY));
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(source);
  }
}

async function api(path, options = {}) {
  const response = await fetch(new URL(path, UPLOAD_API), {
    ...options,
    headers: { "X-Event-Code": eventCode.value.trim(), ...(options.headers || {}) }
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Upload could not be completed. Please try again.");
  return data;
}

function putFile(path, file, item, progressStart, progressEnd) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", new URL(path, UPLOAD_API));
    request.responseType = "json";
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("X-Event-Code", eventCode.value.trim());
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      item.progress = Math.round(progressStart + (event.loaded / event.total) * (progressEnd - progressStart));
      renderQueue();
    });
    request.addEventListener("load", () => request.status >= 200 && request.status < 300
      ? resolve(request.response)
      : reject(new Error(request.response?.error || "Upload could not be completed. Please try again.")));
    request.addEventListener("error", () => reject(new Error("Connection problem. Please try again.")));
    request.send(file);
  });
}

async function uploadFile(item) {
  let uploadId;
  try {
    let poster = null;
    if (isVideoFile(item.file)) {
      item.state = "preparing";
      renderQueue();
      poster = await createVideoPoster(item.file);
    }
    item.state = "reserving";
    renderQueue();
    const reservation = await api("/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: item.file.name,
        contentType: item.file.type,
        sourceSize: item.file.size,
        posterSize: poster?.size || 0,
        uploader: uploaderName.value.trim()
      })
    });
    uploadId = reservation.uploadId;
    item.state = "uploading";
    item.progress = 0;
    renderQueue();
    await putFile(reservation.sourceUrl, item.file, item, 0, poster ? 90 : 98);
    if (poster && reservation.posterUrl) await putFile(reservation.posterUrl, new File([poster], "video-preview.jpg", { type: "image/jpeg" }), item, 90, 98);
    item.state = "publishing";
    item.progress = 100;
    renderQueue();
    await api(`/uploads/${uploadId}/publish`, { method: "POST" });
    item.state = "complete";
    item.progress = 100;
  } catch (error) {
    if (uploadId) await api(`/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    item.state = "error";
    item.error = error.message;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isUploading || items.length === 0) return;
  if (!eventCode.value.trim()) {
    setMessage("Enter the event code to upload your files.");
    eventCode.focus();
    return;
  }
  isUploading = true;
  galleryLink.hidden = true;
  setMessage("Please keep this page open while your files upload.", true);
  for (const item of items) {
    if (item.state === "complete") continue;
    await uploadFile(item);
    renderQueue();
  }
  isUploading = false;
  const failed = items.filter((item) => item.state === "error");
  const complete = items.filter((item) => item.state === "complete");
  if (complete.length) galleryLink.hidden = false;
  setMessage(failed.length ? `${failed.length} file${failed.length === 1 ? " needs" : "s need"} another try.` : "Everything has been uploaded. Thank you!", failed.length === 0);
  renderQueue();
});
