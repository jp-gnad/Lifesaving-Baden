(function () {
  "use strict";

  const pageSize = 30;
  const idBatchSize = 30;
  const names = new Intl.Collator("de", { numeric: true });
  const navigation = { BV: "Bundesverband", LV: "Landesverband", BZ: "Bezirk", OG: "Ortsgruppe" };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mount(collection, container, current, renderFields) {
    async function parentIds(id) {
      if (id === null) return [null];
      // Children of a legacy ID belong on the same branch as the replacement.
      const ids = [id];
      const query = collection.where("aliasOf", "==", id).limit(pageSize);
      let last = null;
      for (;;) {
        const page = await (last ? query.startAfter(last) : query).get({ source: "server" });
        if (!current()) return [];
        ids.push(...page.docs.map(doc => doc.id));
        if (page.docs.length < pageSize) return ids;
        last = page.docs.at(-1);
      }
    }

    function renderNode(doc, data) {
      const disclosure = element("details", "statistics-org-node");
      const summary = element("summary", "statistics-org-summary");
      const label = element("span", "statistics-org-name", data.name || doc.id);
      const type = element("span", "statistics-org-type", data.type || "—");
      if (navigation[data.type]) type.title = navigation[data.type];
      summary.append(label, type);
      if (data.active === false) summary.append(element("span", "statistics-org-state", "Inaktiv"));
      disclosure.append(summary);
      disclosure.addEventListener("toggle", () => {
        if (!current() || !disclosure.open || disclosure.childElementCount > 1) return;
        const content = element("div", "statistics-org-content");
        disclosure.append(content);
        if (data.type === "OG") {
          content.append(renderFields(doc, data));
          return;
        }
        const branch = element("div", "statistics-org-branch");
        const properties = element("details", "statistics-org-properties");
        properties.append(element("summary", "", "Gliederungsdaten"));
        properties.addEventListener("toggle", () => {
          if (current() && properties.open && properties.childElementCount === 1) {
            properties.append(renderFields(doc, data));
          }
        });
        content.append(branch, properties);
        renderBranch(branch, doc.id);
      });
      return disclosure;
    }

    function renderBranch(container, parentId) {
      const list = element("ul", "statistics-org-list");
      const status = element("p", "statistics-import-message statistics-org-status");
      status.setAttribute("role", "status");
      const load = element("button", "button button-secondary statistics-org-more",
        parentId === null ? "Weitere Bundesverbände laden" : "Weitere Gliederungen laden");
      load.type = "button";
      load.hidden = true;
      container.append(list, status, load);
      const entries = new Map();
      let ids, offset = 0, cursor = null, busy = false;

      async function nextPage() {
        if (busy || !current()) return;
        busy = load.disabled = true;
        status.hidden = false;
        status.dataset.state = "";
        status.textContent = parentId === null ? "Bundesverbände werden geladen …" : "Gliederungen werden geladen …";
        try {
          ids ??= await parentIds(parentId);
          if (!current()) return;
          const part = ids.slice(offset, offset + idBatchSize);
          const query = collection.where("parentId", part.length === 1 ? "==" : "in",
            part.length === 1 ? part[0] : part).limit(pageSize);
          const page = await (cursor ? query.startAfter(cursor) : query).get({ source: "server" });
          if (!current()) return;
          for (const doc of page.docs) {
            const data = doc.data();
            if (data.aliasOf || entries.has(doc.id) || (parentId === null && data.type !== "BV")) continue;
            const row = element("li", "statistics-org-row");
            row.append(renderNode(doc, data));
            const name = data.name || doc.id;
            const next = [...list.children].find(node => names.compare(node.dataset.name, name) > 0);
            row.dataset.name = name;
            list.insertBefore(row, next ?? null);
            entries.set(doc.id, row);
          }
          if (page.docs.length < pageSize) {
            offset += part.length;
            cursor = null;
          } else {
            cursor = page.docs.at(-1);
          }
          const complete = offset >= ids.length;
          load.hidden = complete;
          load.textContent = parentId === null ? "Weitere Bundesverbände laden" : "Weitere Gliederungen laden";
          status.hidden = entries.size > 0 || !complete;
          if (!status.hidden) status.textContent = parentId === null
            ? "Keine Bundesverbände gespeichert." : "Keine untergeordneten Gliederungen gespeichert.";
        } catch {
          if (!current()) return;
          status.dataset.state = "error";
          status.textContent = "Die Gliederungen konnten nicht geladen werden.";
          load.textContent = "Erneut laden";
          load.hidden = false;
        } finally {
          busy = load.disabled = false;
        }
      }

      load.addEventListener("click", nextPage);
      nextPage();
    }

    renderBranch(container, null);
  }

  window.LifesavingStatisticsOrganizationTree = Object.freeze({ mount });
})();
