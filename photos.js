const UPLOAD_API_URL = "https://claire-george-party-uploads.claire-george-wedding-2026.workers.dev/upload";
const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
  "video/mp4", "video/quicktime", "video/webm"
]);

const form = document.querySelector("#upload-form");
const eventCode = document.querySelector("#event-code");
const uploaderName = document.querySelector("#uploader-name");
const picker = document.querySelector("#file-picker");
const chooseFiles = document.querySelector("#choose-files");
const uploadAll = document.querySelector("#upload-all");
const queue = document.querySelector("#upload-queue");
const message = document.querySelector("#form-message");
let items = [];
let isUploading = false;

const formatBytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;

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

function renderQueue() {
  queue.replaceChildren();
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "upload-card";
    const preview = document.createElement(item.file.type.startsWith("video/") ? "video" : "img");
    preview.className = "upload-card-preview";
    preview.src = item.preview;
    preview.alt = "";
    if (preview.tagName === "VIDEO") preview.muted = true;
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
    state.textContent = item.state === "complete" ? "Upload complete" : item.state === "uploading" ? `Uploading ${item.progress}%` : item.error || "Ready to upload";
    if (item.state === "error") state.classList.add("is-error");
    copy.append(name, size, state);
    if (item.state === "uploading") {
      const progress = document.createElement("div");
      progress.className = "upload-progress";
      const bar = document.createElement("span");
      bar.style.width = `${item.progress}%`;
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
    } else if (item.state === "uploading") {
      action.textContent = "…";
      action.disabled = true;
      action.setAttribute("aria-label", `${item.file.name} uploading`);
    } else {
      action.textContent = "Remove";
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
  if (files.length > MAX_FILES) return `Please choose no more than ${MAX_FILES} files at a time.`;
  const invalid = files.find((file) => !ALLOWED_TYPES.has(file.type) || file.size > MAX_BYTES);
  if (!invalid) return "";
  if (invalid.size > MAX_BYTES) return `${invalid.name} is larger than 25 MB.`;
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
  setMessage(files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected.` : "", true);
  renderQueue();
});

function uploadFile(item) {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", UPLOAD_API_URL);
    request.responseType = "json";
    request.setRequestHeader("Content-Type", item.file.type);
    request.setRequestHeader("X-Event-Code", eventCode.value.trim());
    request.setRequestHeader("X-File-Name", encodeURIComponent(item.file.name));
    request.setRequestHeader("X-Uploader-Name", encodeURIComponent(uploaderName.value.trim()));
    request.upload.addEventListener("progress", (progressEvent) => {
      if (!progressEvent.lengthComputable) return;
      item.progress = Math.max(1, Math.round((progressEvent.loaded / progressEvent.total) * 100));
      renderQueue();
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        item.state = "complete";
        item.progress = 100;
      } else {
        item.state = "error";
        item.error = request.response?.error || "Upload could not be completed. Please try again.";
      }
      resolve();
    });
    request.addEventListener("error", () => {
      item.state = "error";
      item.error = "Connection problem. Please try again.";
      resolve();
    });
    request.send(item.file);
  });
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
  setMessage("Please keep this page open while your files upload.", true);
  for (const item of items) {
    if (item.state === "complete") continue;
    item.state = "uploading";
    item.progress = 0;
    renderQueue();
    await uploadFile(item);
    renderQueue();
  }
  isUploading = false;
  const failed = items.filter((item) => item.state === "error");
  const complete = items.filter((item) => item.state === "complete");
  if (complete.length) {
    window.setTimeout(() => {
      complete.forEach((item) => removeItem(item.id));
      picker.value = "";
    }, 1200);
  }
  setMessage(failed.length ? `${failed.length} file${failed.length === 1 ? " needs" : "s need"} another try.` : "Everything has been uploaded. Thank you!", failed.length === 0);
  renderQueue();
});
