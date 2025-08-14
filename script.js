document.getElementById("last-updated").textContent =
  new Date(document.lastModified).toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
