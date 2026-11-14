(function (root) {
  "use strict";

  function create({ api, localOptions, escapeHtml, customDisciplineKey, customDisciplineName }) {
    function mount(container, { eventId, prefix, lapCount, initial = {}, isCurrent = () => true }) {
      container.innerHTML = `<div class="custom-discipline-heading"><span class="label">Disziplinenname <small>optional</small></span><small data-custom-count></small></div>
        <label class="field"><span class="sr-only">Disziplinenname</span><input id="${prefix}-name" data-custom-name maxlength="80" placeholder="z. B. 100 m Brust" autocomplete="off"></label>
        <label class="field"><span class="sr-only">Vorherigen Disziplinennamen auswählen</span><select data-custom-choice aria-label="Vorherigen Disziplinennamen auswählen"><option value="">Neuer Name / ohne Namen</option></select></label>
        <p class="muted small" data-custom-status role="status"></p><button class="button secondary small" type="button" data-custom-more hidden>Weitere Namen laden</button>`;
      const input = container.querySelector("[data-custom-name]");
      const choice = container.querySelector("[data-custom-choice]");
      const countLabel = container.querySelector("[data-custom-count]");
      const status = container.querySelector("[data-custom-status]");
      const more = container.querySelector("[data-custom-more]");
      const definitions = new Map();
      let generation = 0, disposed = false, count = 0, cursor = null, hasMore = false;
      const current = (version) => !disposed && generation === version && isCurrent();
      function renderChoices() {
        const selected = choice.value;
        const options = [...definitions.values()].filter((item) => item.lapCount === count)
          .sort((left, right) => left.name.localeCompare(right.name, "de", { numeric: true, sensitivity: "base" }));
        choice.innerHTML = `<option value="">Neuer Name / ohne Namen</option>${options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
        choice.value = definitions.has(selected) ? selected : "";
      }
      async function load(append = false) {
        const version = generation;
        more.disabled = true;
        status.textContent = "Vorherige Namen werden geladen …";
        const local = await localOptions(eventId, count).catch(() => []);
        if (!current(version)) return;
        local.forEach((item) => { if (item.lapCount === count) definitions.set(item.id, item); });
        renderChoices();
        try {
          const page = await api(`/events/${encodeURIComponent(eventId)}/custom-disciplines?laps=${count}${append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
          if (!current(version)) return;
          (page.customDisciplines || []).forEach((item) => { if (item.lapCount === count) definitions.set(item.id, item); });
          cursor = page.nextCursor; hasMore = page.hasMore === true;
          renderChoices();
          status.textContent = "";
          more.textContent = "Weitere Namen laden";
          more.hidden = !hasMore;
        } catch {
          if (!current(version)) return;
          status.textContent = "Vorherige Namen gerade nicht verfügbar. Einen neuen Namen kannst du weiterhin eingeben.";
          more.textContent = "Namen erneut laden";
          more.hidden = false;
        } finally { if (current(version)) more.disabled = false; }
      }
      function update(nextCount) {
        if (nextCount === count || disposed) return;
        generation += 1; count = nextCount; cursor = null; hasMore = false;
        definitions.clear(); choice.value = ""; input.value = "";
        countLabel.textContent = `${count} ${count === 1 ? "Runde" : "Runden"}`;
        renderChoices();
        more.textContent = "Weitere Namen laden"; more.hidden = true;
        load().catch(() => {});
      }
      input.addEventListener("input", () => { choice.value = ""; });
      choice.addEventListener("change", () => { input.value = definitions.get(choice.value)?.name || ""; });
      more.addEventListener("click", () => load(hasMore).catch(() => {}));
      update(lapCount);
      if (initial.customLapCount === count && initial.customDisciplineName) {
        input.value = initial.customDisciplineName;
        const id = initial.customDisciplineId || customDisciplineKey(input.value, count);
        definitions.set(id, { id, name: input.value, lapCount: count });
        renderChoices(); choice.value = id;
      }
      return Object.freeze({ update,
        read() {
          const name = customDisciplineName(input.value);
          return { customDisciplineName: name, customDisciplineId: name ? choice.value : "", customLapCount: name ? count : 0 };
        },
        destroy() { disposed = true; generation += 1; },
      });
    }
    return Object.freeze({ mount });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else root.TimerCustomDisciplinePicker = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
