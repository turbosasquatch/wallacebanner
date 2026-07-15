document.querySelectorAll("[data-carousel]").forEach((carousel) => {
  const track = carousel.querySelector("[data-track]");
  const slides = Array.from(track.querySelectorAll(".carousel-slide"));
  const previous = carousel.querySelector(".carousel-previous");
  const next = carousel.querySelector(".carousel-next");
  const current = carousel.querySelector("[data-current]");
  const total = carousel.querySelector("[data-total]");
  let activeIndex = 0;
  let scrollTimer;

  total.textContent = String(slides.length).padStart(2, "0");

  const update = (index) => {
    activeIndex = Math.max(0, Math.min(index, slides.length - 1));
    current.textContent = String(activeIndex + 1).padStart(2, "0");
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === slides.length - 1;
  };

  const showSlide = (index) => {
    const target = Math.max(0, Math.min(index, slides.length - 1));
    track.scrollTo({ left: slides[target].offsetLeft - track.offsetLeft, behavior: "smooth" });
    update(target);
  };

  previous.addEventListener("click", () => showSlide(activeIndex - 1));
  next.addEventListener("click", () => showSlide(activeIndex + 1));

  track.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showSlide(activeIndex - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showSlide(activeIndex + 1);
    }
  });

  track.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      const trackLeft = track.getBoundingClientRect().left;
      const nearestIndex = slides.reduce((nearest, slide, index) => {
        const distance = Math.abs(slide.getBoundingClientRect().left - trackLeft);
        return distance < nearest.distance ? { index, distance } : nearest;
      }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
      update(nearestIndex);
    }, 80);
  }, { passive: true });

  update(0);
});
