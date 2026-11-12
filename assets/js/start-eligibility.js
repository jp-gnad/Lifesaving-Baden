(function () {
  "use strict";
  const core = window.StartEligibilityCore;
  const byId = (id) => document.getElementById(id);
  const editor = byId("se-editor");
  const form = byId("se-form");
  const primary = byId("se-primary-dates");
  const extra = byId("se-extra-dates");
  const details = byId("se-other-dates");
  const error = byId("se-editor-error");
  let context;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function dateField(key, value, day) {
    const field = node("div", "wt-field");
    const label = node("label", "", core.labels[key]);
    const controls = node("div", "se-date-control");
    const input = node("input");
    input.id = `se-date-${key}`;
    input.type = "date";
    input.name = key;
    input.min = "1900-01-01";
    input.max = day;
    input.value = value || "";
    label.htmlFor = input.id;
    const clear = node("button", "wt-icon-button se-clear-date", "×");
    clear.type = "button";
    clear.setAttribute("aria-label", `${core.labels[key]}: Datum löschen`);
    clear.hidden = !input.value;
    input.addEventListener("input", () => { clear.hidden = !input.value; });
    clear.addEventListener("click", () => { input.value = ""; clear.hidden = true; input.focus(); });
    controls.append(input, clear);
    field.append(label, controls);
    return field;
  }

  function busy(value) {
    form.querySelectorAll("button, input").forEach((element) => { element.disabled = value; });
  }

  function reset() {
    context = null;
    details.open = false;
    primary.replaceChildren();
    extra.replaceChildren();
    byId("se-editor-title").textContent = "";
    byId("se-editor-meta").textContent = "";
    error.hidden = true;
    busy(false);
  }

  function open(options) {
    reset();
    context = options;
    const { person, nextSeason } = options;
    const day = core.today();
    const { age, group } = core.evaluate(person, day, nextSeason);
    const exams = age === null ? ["rescueBronze", "rescueSilver", "combinedExercise"]
      : age >= 16 && age < 50 ? ["combinedExercise", "rescueSilver"]
        : [age >= 13 ? "rescueBronze" : age >= 10 ? "swimGold" : "swimSilver"];
    const keys = ["healthDeclaration", ...exams];
    const remaining = core.dateKeys.filter((key) => !keys.includes(key) && key !== "combinedExercise");
    byId("se-editor-title").textContent = window.ClubsCore.displayName(person);
    byId("se-editor-meta").textContent = [group, core.seasonYear(day, nextSeason)].join(" · ");
    primary.replaceChildren(...keys.map((key) => dateField(key, person[key], day)));
    extra.replaceChildren(...remaining.map((key) => dateField(key, person[key], day)));
    details.open = remaining.some((key) => core.validDate(person[key]));
    editor.showModal();
  }

  function close() {
    editor.close();
    reset();
  }

  editor.querySelector("[data-se-close]").addEventListener("click", close);
  editor.addEventListener("close", () => { if (!editor.open) reset(); });
  editor.addEventListener("cancel", (event) => { if (byId("se-save").disabled) event.preventDefault(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = context;
    if (!current || !current.isCurrent() || byId("se-save").disabled) return;
    const changes = {};
    const sdk = window.firebase.firestore;
    for (const [key, value] of new FormData(form)) {
      if (value && (!core.validDate(value) || value > core.today())) {
        error.textContent = "Bitte prüfe das Datum.";
        error.hidden = false;
        return;
      }
      if (value !== (current.person[key] || "")) changes[key] = value ? sdk.Timestamp.fromDate(core.asDate(value)) : null;
    }
    if (!Object.keys(changes).length) { close(); return; }
    busy(true);
    error.hidden = true;
    try {
      await window.ClubsStore.saveDates(current.db, current.clubId, current.subjectId, changes, sdk, current.requireCurrent, current.person.createdAt);
      if (context === current && current.isCurrent()) close();
    } catch (failure) {
      if (context !== current || !current.isCurrent()) return;
      error.textContent = failure.code?.startsWith("clubs/") ? failure.message : "Nachweise konnten nicht gespeichert werden. Bitte erneut versuchen.";
      error.hidden = false;
    } finally {
      if (context === current) busy(false);
    }
  });
  window.StartEligibilityEditor = Object.freeze({ open, close });
})();
