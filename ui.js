// Page UI, kept apart from the 3D world so the page still works if WebGL or the CDN fails.
const root = document.documentElement;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

document.getElementById("yr").textContent = new Date().getFullYear();

// ---------- loader ----------
let shown = false;
function show() {
  if (shown) return;
  shown = true;
  requestAnimationFrame(() => {
    document.getElementById("loader").classList.add("done");
    document.body.classList.add("loaded");
    setTimeout(() => root.classList.add("settled"), 1600); // headline slide-in finished
  });
}
addEventListener("worldready", show);
setTimeout(show, 6000); // the world never arrived: show the page without it

// ---------- reveal on scroll ----------
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    io.unobserve(e.target);
  });
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

// hide the scroll hint once the visitor has started scrolling
const onScroll = () => root.classList.toggle("scrolled", scrollY > 40);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- copy Discord handle ----------
const copied = document.querySelector(".copied");
let copiedTimer;
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      copied.textContent = `Copied "${text}" — add me on Discord`;
    } catch {
      copied.textContent = `Discord: ${text}`; // clipboard blocked: at least show it
    }
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.textContent = ""; }, 3000);
  });
});

// ---------- cursor + card tilt (mouse only) ----------
if (finePointer) {
  const cursor = document.querySelector(".cursor");
  let cx = 0, cy = 0, tx = 0, ty = 0, moving = false;
  // only animate while the ring is catching up to the pointer
  const follow = () => {
    cx += (tx - cx) * 0.2; cy += (ty - cy) * 0.2;
    cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    moving = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.1;
    if (moving) requestAnimationFrame(follow);
  };
  addEventListener("pointermove", (e) => {
    tx = e.clientX; ty = e.clientY;
    cursor.classList.add("on");
    if (!moving) { moving = true; requestAnimationFrame(follow); }
  });
  document.querySelectorAll("a, button, .card").forEach((el) => {
    el.addEventListener("pointerenter", () => cursor.classList.add("hover"));
    el.addEventListener("pointerleave", () => cursor.classList.remove("hover"));
  });

  document.querySelectorAll("[data-tilt]").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.transform = `rotateY(${(x - .5) * 12}deg) rotateX(${(.5 - y) * 12}deg)`;
      card.style.setProperty("--mx", `${x * 100}%`);
      card.style.setProperty("--my", `${y * 100}%`);
    });
    card.addEventListener("pointerleave", () => { card.style.transform = ""; });
  });
}
