/**
 * pdf.js — PDF blueprint export.
 */

export async function exportPDF({
  previewDataURLs = null,
  previewDataURL = null,
  selections,
  windowsMaterial = 'printed',
  parts,
  colors,
  filamentUsage = {},
}) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    throw new Error('PDF export is unavailable because jsPDF did not load. Refresh the page and try again.');
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 14;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const TABLE_ROW_H = 8;
  const TABLE_HEADER_TOP_H = 5;
  const TABLE_HEADER_SUB_H = 5;
  const TABLE_HEADER_H = TABLE_HEADER_TOP_H + TABLE_HEADER_SUB_H;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Gata-Gata Gacha Machine — Build Blueprint', MARGIN, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated: ${new Date().toLocaleString()}`, MARGIN, 27);
  doc.setTextColor(0);

  let yPos = 34;
  const previewSlots = _normalizePreviewSlots(previewDataURLs, previewDataURL);
  if (previewSlots.length) {
    yPos = await _drawPreviewRow(doc, previewSlots, {
      pageWidth: PAGE_W,
      margin: MARGIN,
      contentWidth: CONTENT_W,
      yPos,
    });
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Parts & Colors', MARGIN, yPos);
  yPos += 6;

  const colorMap = {};
  colors.forEach(color => { colorMap[color.id] = color; });

  const columns = {
    part: { x: MARGIN, width: 62 },
    color: { x: MARGIN + 62, width: 64 },
    hex: { x: MARGIN + 126, width: 21 },
    bitty: { x: MARGIN + 147, width: 17.5 },
    biggy: { x: MARGIN + 164.5, width: 17.5 },
  };

  const drawTableHeader = (topY, continued = false) => {
    if (continued) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text('Parts & Colors (continued)', MARGIN, topY);
      topY += 6;
    }

    // Fill entire header area (both rows) with dark background
    doc.setFillColor(50, 50, 50);
    doc.rect(MARGIN, topY, CONTENT_W, TABLE_HEADER_H, 'F');

    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);

    // "Part", "Bambu Color", "Hex" span both header rows — draw text centered
    // vertically over the full header height (no horizontal divider under them).
    const fullHeaderMidY = topY + TABLE_HEADER_H / 2 + 3; // +3 for jsPDF baseline offset
    doc.text('Part', columns.part.x + 1, fullHeaderMidY);
    doc.text('Bambu Color', columns.color.x + 1, fullHeaderMidY);
    doc.text('Hex', columns.hex.x + 1, fullHeaderMidY);

    // "Filament Usage" spans Bitty+Biggy columns in the TOP sub-row only
    doc.text(
      'Filament Usage',
      columns.bitty.x + (columns.bitty.width + columns.biggy.width) / 2,
      topY + TABLE_HEADER_TOP_H / 2 + 3,
      { align: 'center' }
    );

    // Horizontal divider ONLY under "Filament Usage" (between the two sub-rows,
    // but only spanning the Filament Usage group columns, not Part/Color/Hex).
    doc.setDrawColor(210);
    doc.line(columns.bitty.x, topY + TABLE_HEADER_TOP_H, MARGIN + CONTENT_W, topY + TABLE_HEADER_TOP_H);

    // Sub-labels "Bitty" and "Biggy" in the BOTTOM sub-row
    doc.text('Bitty', columns.bitty.x + columns.bitty.width / 2, topY + TABLE_HEADER_TOP_H + TABLE_HEADER_SUB_H / 2 + 3, { align: 'center' });
    doc.text('Biggy', columns.biggy.x + columns.biggy.width / 2, topY + TABLE_HEADER_TOP_H + TABLE_HEADER_SUB_H / 2 + 3, { align: 'center' });

    // Outer border around the full header
    doc.setDrawColor(210);
    doc.rect(MARGIN, topY, CONTENT_W, TABLE_HEADER_H, 'S');

    // Vertical column dividers (spanning full header height)
    [
      columns.part.x,
      columns.color.x,
      columns.hex.x,
      columns.bitty.x,
      columns.biggy.x,
      MARGIN + CONTENT_W,
    ].forEach(x => doc.line(x, topY, x, topY + TABLE_HEADER_H));

    // Vertical divider between Bitty and Biggy only in the bottom sub-row
    // (already drawn above as part of column dividers — this is intentional)

    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    return topY + TABLE_HEADER_H;
  };

  const ensureRowSpace = neededHeight => {
    if (yPos + neededHeight <= PAGE_H - 20) return;
    doc.addPage();
    yPos = drawTableHeader(MARGIN, true);
  };

  yPos = drawTableHeader(yPos);

  let rowIndex = 0;
  parts.forEach(part => {
    const isWindow = part.id === 'window';
    const colorId = selections[part.id] || part.defaultColorId;
    const color = colorMap[colorId];
    const usage = filamentUsage[part.id] || {};

    ensureRowSpace(TABLE_ROW_H);

    if (rowIndex % 2 === 0) {
      doc.setFillColor(245, 245, 245);
      doc.rect(MARGIN, yPos, CONTENT_W, TABLE_ROW_H, 'F');
    }

    doc.setDrawColor(215);
    doc.rect(MARGIN, yPos, CONTENT_W, TABLE_ROW_H, 'S');
    [
      columns.part.x,
      columns.color.x,
      columns.hex.x,
      columns.bitty.x,
      columns.biggy.x,
      MARGIN + CONTENT_W,
    ].forEach(x => doc.line(x, yPos, x, yPos + TABLE_ROW_H));

    doc.setFontSize(8);

    if (isWindow) {
      if (windowsMaterial === 'acrylic') {
        doc.text('Windows', columns.part.x + 1, yPos + 5.5);
        doc.text('Clear acrylic', columns.color.x + 1, yPos + 5.5);
      } else if (color) {
        _drawSwatch(doc, color.hex, columns.color.x - 7, yPos + 1.5);
        doc.text('Windows (×2)', columns.part.x + 1, yPos + 5.5);
        doc.text(color.name, columns.color.x + 1, yPos + 5.5);
        doc.text(color.hex, columns.hex.x + 1, yPos + 5.5);
      }
    } else if (color) {
      const partLabel = part.qty && part.qty > 1 ? `${part.label} (×${part.qty})` : part.label;
      const displayLabel = part.id === 'coin' ? `${partLabel} (×25 est.)` : partLabel;
      _drawSwatch(doc, color.hex, columns.color.x - 7, yPos + 1.5);
      doc.text(displayLabel, columns.part.x + 1, yPos + 5.5);
      doc.text(color.name, columns.color.x + 1, yPos + 5.5);
      doc.text(color.hex, columns.hex.x + 1, yPos + 5.5);
    }

    if (!(isWindow && windowsMaterial === 'acrylic')) {
      if (typeof usage.bitty === 'number') {
        doc.text(`${usage.bitty} g`, columns.bitty.x + columns.bitty.width / 2, yPos + 5.5, { align: 'center' });
      }
      if (typeof usage.biggy === 'number') {
        doc.text(`${usage.biggy} g`, columns.biggy.x + columns.biggy.width / 2, yPos + 5.5, { align: 'center' });
      }
    }

    yPos += TABLE_ROW_H;
    rowIndex += 1;
  });

  yPos = _drawFilamentByColorSummary(doc, {
    yPos: yPos + 7,
    margin: MARGIN,
    pageHeight: PAGE_H,
    contentWidth: CONTENT_W,
    selections,
    windowsMaterial,
    parts,
    colors,
    filamentUsage,
  });

  const pageCount = doc.getNumberOfPages();
  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
    doc.setPage(pageIndex);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Lightning Bug Club — lightningbugclub.com', MARGIN, 290);
    doc.text(`Page ${pageIndex} of ${pageCount}`, PAGE_W - MARGIN, 290, { align: 'right' });
  }

  function _drawFilamentByColorSummary(doc, {
    yPos,
    margin,
    pageHeight,
    contentWidth,
    selections,
    windowsMaterial,
    parts,
    colors,
    filamentUsage,
  }) {
    const colorMap = {};
    colors.forEach(color => { colorMap[color.id] = color; });

    const totals = new Map();
    parts.forEach(part => {
      if (part.id === 'window' && windowsMaterial === 'acrylic') return;
      const colorId = selections[part.id] || part.defaultColorId;
      const color = colorMap[colorId];
      if (!color) return;
      const usage = filamentUsage[part.id] || {};
      const current = totals.get(color.id) || { color, bitty: 0, biggy: 0 };
      current.bitty += typeof usage.bitty === 'number' ? usage.bitty : 0;
      current.biggy += typeof usage.biggy === 'number' ? usage.biggy : 0;
      totals.set(color.id, current);
    });

    const rows = Array.from(totals.values()).sort((a, b) => b.biggy - a.biggy);
    if (!rows.length) return yPos;

    const ensureSpace = required => {
      if (yPos + required <= pageHeight - 20) return;
      doc.addPage();
      yPos = margin;
    };

    ensureSpace(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Filament Needed by Color', margin, yPos);
    yPos += 5;

    const cols = {
      swatch: { x: margin, width: 16 },
      name: { x: margin + 16, width: 102 },
      bitty: { x: margin + 118, width: 32 },
      biggy: { x: margin + 150, width: 32 },
    };
    const headerH = 8;
    const rowH = 7;

    ensureSpace(headerH + rowH);
    doc.setFillColor(50, 50, 50);
    doc.rect(margin, yPos, contentWidth, headerH, 'F');
    doc.setTextColor(255);
    doc.setFontSize(8.5);
    doc.text('Color', cols.swatch.x + cols.swatch.width + 1, yPos + 5.2);
    doc.text('Bitty (g)', cols.bitty.x + cols.bitty.width / 2, yPos + 5.2, { align: 'center' });
    doc.text('Biggy (g)', cols.biggy.x + cols.biggy.width / 2, yPos + 5.2, { align: 'center' });
    doc.setDrawColor(210);
    [margin, cols.name.x, cols.bitty.x, cols.biggy.x, margin + contentWidth].forEach(x => {
      doc.line(x, yPos, x, yPos + headerH);
    });
    doc.rect(margin, yPos, contentWidth, headerH, 'S');
    doc.setTextColor(0);
    yPos += headerH;

    rows.forEach((row, index) => {
      ensureSpace(rowH);
      if (index % 2 === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(margin, yPos, contentWidth, rowH, 'F');
      }
      doc.setDrawColor(215);
      [margin, cols.name.x, cols.bitty.x, cols.biggy.x, margin + contentWidth].forEach(x => {
        doc.line(x, yPos, x, yPos + rowH);
      });
      doc.rect(margin, yPos, contentWidth, rowH, 'S');
      _drawSwatch(doc, row.color.hex, cols.swatch.x + 5.5, yPos + 1);
      doc.setFontSize(8);
      doc.text(`${row.color.name} (${row.color.hex})`, cols.name.x + 1, yPos + 4.8);
      doc.text(String(row.bitty), cols.bitty.x + cols.bitty.width / 2, yPos + 4.8, { align: 'center' });
      doc.text(String(row.biggy), cols.biggy.x + cols.biggy.width / 2, yPos + 4.8, { align: 'center' });
      yPos += rowH;
    });

    ensureSpace(7);
    doc.setFontSize(7.5);
    doc.setTextColor(90);
    doc.text('Coin usage estimates are for 25 coins. Lid Lock usage is an estimated 6 g.', margin, yPos + 4);
    doc.setTextColor(0);
    return yPos + 7;
  }

  doc.save('gatagata-build-blueprint.pdf');
}

async function _drawPreviewRow(doc, slots, { pageWidth, margin, contentWidth, yPos }) {
  const gap = slots.length === 1 ? 0 : 6;
  const slotWidth = slots.length === 1
    ? Math.min(108, contentWidth)
    : (contentWidth - gap * (slots.length - 1)) / slots.length;
  const frameHeight = slots.length === 1 ? 68 : 42;
  const captionOffset = 4.5;
  const startX = margin + (contentWidth - (slotWidth * slots.length + gap * (slots.length - 1))) / 2;

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const slotX = startX + index * (slotWidth + gap);

    doc.setDrawColor(205);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(slotX, yPos, slotWidth, frameHeight, 1.5, 1.5, 'FD');

    if (slot.dataURL) {
      try {
        const size = await _getImageDimensions(slot.dataURL);
        const maxWidth = slotWidth - 4;
        const maxHeight = frameHeight - 4;
        const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
        const drawWidth = size.width * scale;
        const drawHeight = size.height * scale;
        const drawX = slotX + (slotWidth - drawWidth) / 2;
        const drawY = yPos + (frameHeight - drawHeight) / 2;
        doc.addImage(slot.dataURL, 'PNG', drawX, drawY, drawWidth, drawHeight);
      } catch (_) {
        // Leave the frame empty if a single image cannot be decoded.
      }
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80);
    doc.text(slot.label, slotX + slotWidth / 2, yPos + frameHeight + captionOffset, { align: 'center' });
    doc.setTextColor(0);
  }

  return yPos + frameHeight + captionOffset + 5;
}

function _normalizePreviewSlots(previewDataURLs, previewDataURL) {
  if (previewDataURLs && !Array.isArray(previewDataURLs) && typeof previewDataURLs === 'object') {
    return [
      { label: 'Front', dataURL: previewDataURLs.front || null },
      { label: 'Side', dataURL: previewDataURLs.side || null },
      { label: 'Back', dataURL: previewDataURLs.back || null },
    ];
  }

  if (Array.isArray(previewDataURLs) && previewDataURLs.length) {
    return previewDataURLs.map((dataURL, index) => ({
      label: ['Front', 'Side', 'Back'][index] || `View ${index + 1}`,
      dataURL: dataURL || null,
    }));
  }

  if (previewDataURL) {
    return [{ label: 'Preview', dataURL: previewDataURL }];
  }

  return [];
}

function _drawSwatch(doc, hex, x, y) {
  const rgb = _hexToRGB(hex);
  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.rect(x, y, 5, 5, 'F');
  doc.setDrawColor(180);
  doc.rect(x, y, 5, 5, 'S');
  doc.setDrawColor(215);
}

function _getImageDimensions(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error('Could not decode preview image.'));
    img.src = dataURL;
  });
}

function _hexToRGB(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}
