(function (root) {
  "use strict";

  function create({ eventIconUrls, fetchImage = (...args) => fetch(...args), timeoutMs = 8000 }) {
    function pdfSafeText(value) {
      return String(value ?? "")
        .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
        .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
        .replace(/ß/g, "ss").replace(/×/g, "x")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]/g, "?");
    }

    function pdfEscapedText(value) {
      return pdfSafeText(value).replace(/([\\()])/g, "\\$1");
    }

    const images = new Map();
    async function readImage(url, budget) {
      const controller = new AbortController();
      let objectUrl, element, timer;
      const expired = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          if (element) element.src = "";
          reject(new Error("Eventbild konnte nicht rechtzeitig geladen werden."));
        }, budget);
      });
      try {
        const load = (async () => {
          const response = await fetchImage(url, { cache: "force-cache", signal: controller.signal });
          if (!response.ok) throw new Error("Eventbild ist nicht verfügbar.");
          const blob = await response.blob();
          if (controller.signal.aborted) throw new Error("Eventbild wurde abgebrochen.");
          const image = await new Promise((resolve, reject) => {
            objectUrl = URL.createObjectURL(blob);
            element = new Image();
            element.addEventListener("load", () => resolve(element), { once: true });
            element.addEventListener("error", () => reject(new Error("Eventbild konnte nicht gelesen werden.")), { once: true });
            element.src = objectUrl;
          });
          if (controller.signal.aborted) throw new Error("Eventbild wurde abgebrochen.");
          const maximumPixels = 180;
          const scale = Math.min(1, maximumPixels / Math.max(image.naturalWidth, image.naturalHeight));
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) return null;
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          const jpegBase64 = canvas.toDataURL("image/jpeg", .9).split(",")[1];
          const binary = atob(jpegBase64);
          let hex = "";
          for (let index = 0; index < binary.length; index += 1) hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
          return { width, height, hex };
        })();
        return await Promise.race([load, expired]);
      } finally {
        clearTimeout(timer);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    }

    function loadEventPdfImage(event) {
      const urls = eventIconUrls(event), key = JSON.stringify(urls);
      if (images.has(key)) return images.get(key);
      const pending = (async () => {
        const deadline = Date.now() + timeoutMs;
        for (const url of urls) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          try { return await readImage(url, Math.min(3000, remaining)); }
          catch { /* An optional picture must never prevent a complete export. */ }
        }
        return null;
      })().then((image) => { if (!image && images.get(key) === pending) images.delete(key); return image; });
      images.set(key, pending);
      if (images.size > 20) images.delete(images.keys().next().value);
      return pending;
    }

    function createResultsPdf(title, subtitle, headers, rows, eventImage = null) {
      const pageWidth = 841.89;
      const pageHeight = 595.28;
      const margin = 28;
      const titleHeight = 42;
      const headerHeight = 26;
      const rowHeight = 23;
      const rowsPerPage = Math.max(1, Math.floor((pageHeight - (margin * 2) - titleHeight - headerHeight) / rowHeight));
      const pageRows = [];
      for (let index = 0; index < rows.length; index += rowsPerPage) pageRows.push(rows.slice(index, index + rowsPerPage));
      if (!pageRows.length) pageRows.push([]);

      const usableWidth = pageWidth - (margin * 2);
      const fontSize = headers.length > 14 ? 6 : 7;
      const cellMain = (value) => typeof value === "object" && value !== null ? value.main : value;
      const approximateTextWidth = (value, size = fontSize) => pdfSafeText(value).length * size * .52;
      const longestPersonWidth = Math.max(
        approximateTextWidth(cellMain(headers[0])),
        ...rows.map((row) => Math.max(approximateTextWidth(cellMain(row[0])),
          approximateTextWidth(row[0]?.secondary || "", Math.max(5, fontSize - 1.5)))),
      ) + 8;
      const otherColumnCount = Math.max(1, headers.length - 1);
      const personWidth = Math.min(longestPersonWidth, usableWidth - (otherColumnCount * 22));
      const otherWidth = (usableWidth - personWidth) / otherColumnCount;
      const scaledWidths = headers.map((_, index) => index === 0 ? personWidth : otherWidth);

      const truncate = (value, width, size = fontSize) => {
        const text = pdfSafeText(value);
        const maximum = Math.max(1, Math.floor((width - 6) / (size * .52)));
        return text.length > maximum ? `${text.slice(0, Math.max(1, maximum - 2))}..` : text;
      };
      const textStart = (value, x, width, size, centered) => {
        if (!centered) return x + 3;
        const renderedWidth = Math.min(width - 6, approximateTextWidth(value, size));
        return x + ((width - renderedWidth) / 2);
      };
      const generatedAt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date());
      const pageContents = pageRows.map((pageData, pageIndex) => {
        const commands = [];
        commands.push("0 g 0 G 0.45 w");
        let titleX = margin;
        if (eventImage) {
          const imageScale = Math.min(30 / eventImage.width, 30 / eventImage.height);
          const imageWidth = eventImage.width * imageScale;
          const imageHeight = eventImage.height * imageScale;
          const imageY = pageHeight - margin - 34 + ((30 - imageHeight) / 2);
          commands.push(`q ${imageWidth.toFixed(2)} 0 0 ${imageHeight.toFixed(2)} ${margin} ${imageY.toFixed(2)} cm /Im1 Do Q`);
          titleX += imageWidth + 8;
        }
        commands.push(`BT /F2 13 Tf ${titleX.toFixed(2)} ${pageHeight - margin - 12} Td (${pdfEscapedText(title)}) Tj ET`);
        commands.push(`0.35 g BT /F1 8 Tf ${titleX.toFixed(2)} ${pageHeight - margin - 26} Td (${pdfEscapedText(subtitle)}) Tj ET`);
        const dateWidth = approximateTextWidth(generatedAt, 7);
        commands.push(`0.35 g BT /F1 7 Tf ${(pageWidth - margin - dateWidth).toFixed(2)} ${pageHeight - margin - 12} Td (${pdfEscapedText(generatedAt)}) Tj ET`);
        const footer = `Seite ${pageIndex + 1}/${pageRows.length}`;
        const footerWidth = approximateTextWidth(footer, 7);
        commands.push(`0.35 g BT /F1 7 Tf ${((pageWidth - footerWidth) / 2).toFixed(2)} 14 Td (${footer}) Tj ET`);
        let top = pageHeight - margin - titleHeight;
        let x = margin;
        headers.forEach((header, index) => {
          const width = scaledWidths[index];
          const value = typeof header === "object" && header !== null ? header : { main: header };
          const centered = index > 0;
          const headerMainSize = fontSize;
          const headerSecondarySize = Math.max(4.5, fontSize - 1.5);
          const mainText = truncate(value.main, width, headerMainSize);
          const secondaryText = value.secondary ? truncate(value.secondary, width, headerSecondarySize) : "";
          const mainX = textStart(mainText, x, width, headerMainSize, centered);
          commands.push(`0.93 g ${x.toFixed(2)} ${(top - headerHeight).toFixed(2)} ${width.toFixed(2)} ${headerHeight} re f`);
          commands.push(`0 g 0 G ${x.toFixed(2)} ${(top - headerHeight).toFixed(2)} ${width.toFixed(2)} ${headerHeight} re S`);
          commands.push(`0 g BT /F2 ${headerMainSize} Tf ${mainX.toFixed(2)} ${(top - (secondaryText ? 11 : 16)).toFixed(2)} Td (${pdfEscapedText(mainText)}) Tj ET`);
          if (secondaryText) {
            const secondaryX = textStart(secondaryText, x, width, headerSecondarySize, centered);
            commands.push(`0.35 g BT /F1 ${headerSecondarySize} Tf ${secondaryX.toFixed(2)} ${(top - 20).toFixed(2)} Td (${pdfEscapedText(secondaryText)}) Tj ET`);
          }
          x += width;
        });
        top -= headerHeight;
        pageData.forEach((row) => {
          x = margin;
          for (let index = 0; index < row.length;) {
            const cell = row[index];
            if (typeof cell === "object" && cell?.skip) {
              index += 1;
              continue;
            }
            const value = typeof cell === "object" && cell !== null ? cell : { main: cell };
            const columnSpan = Math.max(1, Math.min(Number(value.colSpan) || 1, row.length - index));
            const width = scaledWidths.slice(index, index + columnSpan).reduce((sum, columnWidth) => sum + columnWidth, 0);
            const hasSecondary = Boolean(value.secondary);
            const centered = index > 0;
            const mainText = truncate(value.main, width);
            const mainX = textStart(mainText, x, width, fontSize, centered);
            commands.push(`0 G ${x.toFixed(2)} ${(top - rowHeight).toFixed(2)} ${width.toFixed(2)} ${rowHeight} re S`);
            commands.push(`0 g BT /${value.bold ? "F2" : "F1"} ${fontSize} Tf ${mainX.toFixed(2)} ${(top - (hasSecondary ? 9.5 : 14.5)).toFixed(2)} Td (${pdfEscapedText(mainText)}) Tj ET`);
            if (hasSecondary) {
              const secondarySize = Math.max(5, fontSize - 1.5);
              const secondaryText = truncate(value.secondary, width, secondarySize);
              const secondaryX = textStart(secondaryText, x, width, secondarySize, centered);
              commands.push(value.tone === "frequency" ? "0.58 0.38 0 rg" : "0.48 g");
              commands.push(`BT /F1 ${secondarySize} Tf ${secondaryX.toFixed(2)} ${(top - 17.5).toFixed(2)} Td (${pdfEscapedText(secondaryText)}) Tj ET`);
              commands.push("0 g");
            }
            x += width;
            index += columnSpan;
          }
          top -= rowHeight;
        });
        return commands.join("\n");
      });

      const fontRegularId = 3 + (pageContents.length * 2);
      const fontBoldId = fontRegularId + 1;
      const imageId = eventImage ? fontBoldId + 1 : null;
      const objects = [];
      const pageIds = pageContents.map((_, index) => 3 + (index * 2));
      objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
      objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
      pageContents.forEach((content, index) => {
        const pageId = pageIds[index];
        const contentId = pageId + 1;
        const imageResources = imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : "";
        objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${imageResources} >> /Contents ${contentId} 0 R >>`;
        objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      });
      objects[fontRegularId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
      objects[fontBoldId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
      if (imageId) objects[imageId] = `<< /Type /XObject /Subtype /Image /Width ${eventImage.width} /Height ${eventImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${eventImage.hex.length + 1} >>\nstream\n${eventImage.hex}>\nendstream`;

      let documentText = "%PDF-1.4\n";
      const offsets = [0];
      for (let id = 1; id < objects.length; id += 1) {
        offsets[id] = documentText.length;
        documentText += `${id} 0 obj\n${objects[id]}\nendobj\n`;
      }
      const xrefOffset = documentText.length;
      documentText += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
      for (let id = 1; id < objects.length; id += 1) documentText += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
      documentText += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
      return new Blob([documentText], { type: "application/pdf" });
    }

    function openPdf(blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }


    return Object.freeze({ createResultsPdf, loadEventPdfImage, openPdf });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else root.TimerResultsPdf = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
