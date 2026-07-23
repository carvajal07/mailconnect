// advancedTableBuild.js — shared "InsertTableDialog options → full table" builder.
//
// Single source of truth used by BOTH the right-click insert (inside a content
// area) and the ElementBar "Tabla avanzada" flow, so both produce identical,
// fully-atado tables: each section's border config becomes a border-style ref
// (lines + color via findOrCreate), an outer table border style is created when
// rounded corners / outer border are requested, and buildTableStructure wires
// the rowSets. Returns everything the embedded-table factory needs.

import { buildTableStructure } from './InsertTableDialog.jsx';
import { countTablesInTemplate, countRowSetsInTemplate, countCellsInTemplate } from '../../hooks/useTableRowSets.js';

export function buildTableFromDialogOptions(options, state) {
  const t = state?.template;
  const startTableNum = countTablesInTemplate(t) + 1;
  const startRowNum   = countRowSetsInTemplate(t) + 1;
  const startCellNum  = countCellsInTemplate(t) + 1;

  // A section's raw {preset,color,width} → a shared border-style id (atado:
  // color registered in the palette, border style deduped by findOrCreate).
  function configToStyleRef(cfg) {
    if (!cfg || cfg.preset === 'none') return null;
    const colorId = state?.findOrCreateColor?.(cfg.color ?? '#000000');
    const styleId = state?.findOrCreateBorderStyle?.({
      lineColorId: colorId,
      lineColor:   cfg.color ?? '#000000',
      lineWidth:   cfg.width ?? 0.25,
      lineStyle:   'Solid',
      sides: { top: { enabled: true }, right: { enabled: true }, bottom: { enabled: true }, left: { enabled: true } },
    });
    if (!styleId) return null;
    return { styleId, preset: cfg.preset };
  }

  const headerBorderRef      = configToStyleRef(options.headerBorder);
  const firstHeaderBorderRef = configToStyleRef(options.firstHeaderBorder);
  const bodyBorderRef        = configToStyleRef(options.bodyBorder);
  const footerBorderRef      = configToStyleRef(options.footerBorder);
  const lastFooterBorderRef  = configToStyleRef(options.lastFooterBorder);

  // Outer table border style (perimeter + rounded corners) when requested.
  let tableBorderStyleId = null;
  const tr = options.tableRadius ?? 0;
  const tc = options.tableCorners ?? { tl: true, tr: true, br: true, bl: true };
  const ob = options.outerBorder;
  const wantsCorners      = tr > 0 && (tc.tl || tc.tr || tc.br || tc.bl);
  const wantsOuterBorder  = ob && ob.preset !== 'none';
  const cellCornersAllMode = options.cellCornersAll === true;
  if ((wantsCorners || wantsOuterBorder) && !cellCornersAllMode) {
    const obColor = ob?.color ?? '#000000';
    const obWidth = ob?.width ?? 0.25;
    const obColorId = state?.findOrCreateColor?.(obColor);
    const cornerEntry = (active) => active && tr > 0
      ? { corner: 'Round', radiusX: tr, radiusY: tr }
      : { corner: 'Standard', radiusX: 0, radiusY: 0 };
    tableBorderStyleId = state?.findOrCreateBorderStyle?.({
      lineColorId: wantsOuterBorder ? obColorId : null,
      lineColor:   wantsOuterBorder ? obColor : '#000000',
      lineWidth:   obWidth,
      lineStyle:   'Solid',
      sides: {
        top:    { enabled: !!wantsOuterBorder },
        right:  { enabled: !!wantsOuterBorder },
        bottom: { enabled: !!wantsOuterBorder },
        left:   { enabled: !!wantsOuterBorder },
      },
      corners: {
        topLeft:     cornerEntry(tc.tl),
        topRight:    cornerEntry(tc.tr),
        bottomRight: cornerEntry(tc.br),
        bottomLeft:  cornerEntry(tc.bl),
      },
    }) ?? null;
  }

  const structure = buildTableStructure({
    ...options,
    startTableNum, startRowNum, startCellNum,
    headerBorder:      headerBorderRef,
    firstHeaderBorder: firstHeaderBorderRef,
    bodyBorder:        bodyBorderRef,
    footerBorder:      footerBorderRef,
    lastFooterBorder:  lastFooterBorderRef,
  });
  return { ...structure, tableNum: startTableNum, borderStyleId: tableBorderStyleId };
}
