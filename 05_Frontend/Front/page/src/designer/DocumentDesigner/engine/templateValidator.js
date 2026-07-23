// engine/templateValidator.js — Valida el template JSON antes de guardar

export function validateTemplate(template) {
  const errors = [];
  const warnings = [];

  if (!template || typeof template !== 'object') {
    errors.push('Template inválido: debe ser un objeto');
    return { valid: false, errors, warnings };
  }

  // Version
  if (!template.version) {
    warnings.push('Sin versión definida, se usará 1.0');
  }

  // Pages
  if (!Array.isArray(template.pages) || template.pages.length === 0) {
    errors.push('El template debe tener al menos una página');
  } else {
    const pageIds = new Set();
    template.pages.forEach((page, i) => {
      if (!page.id) {
        errors.push(`Página ${i + 1}: falta el id`);
      } else if (pageIds.has(page.id)) {
        errors.push(`Página ${i + 1}: id duplicado "${page.id}"`);
      } else {
        pageIds.add(page.id);
      }

      if (!page.size) {
        warnings.push(`Página ${i + 1}: sin tamaño, se usará A4`);
      }

      // Validar pageFlow referencias
      if (page.pageFlow?.type === 'goto' && page.pageFlow.gotoPageId) {
        if (!template.pages.find(p => p.id === page.pageFlow.gotoPageId)) {
          errors.push(`Página "${page.id}": pageFlow.gotoPageId "${page.pageFlow.gotoPageId}" no existe`);
        }
      }
      if (page.pageFlow?.type === 'conditional') {
        (page.pageFlow.conditions ?? []).forEach(cond => {
          if (cond.nextPageId && !template.pages.find(p => p.id === cond.nextPageId)) {
            errors.push(`Página "${page.id}": condición apunta a página "${cond.nextPageId}" que no existe`);
          }
        });
        if (page.pageFlow.defaultNextPageId && !template.pages.find(p => p.id === page.pageFlow.defaultNextPageId)) {
          errors.push(`Página "${page.id}": defaultNextPageId "${page.pageFlow.defaultNextPageId}" no existe`);
        }
      }

      // Validar elementos
      const elIds = new Set();
      (page.elements ?? []).forEach((el, j) => {
        if (!el.id) {
          errors.push(`Página "${page.id}", elemento ${j + 1}: falta el id`);
        } else if (elIds.has(el.id)) {
          errors.push(`Página "${page.id}": elemento id duplicado "${el.id}"`);
        } else {
          elIds.add(el.id);
        }
        if (!el.type) {
          errors.push(`Elemento "${el.id}": falta el type`);
        }
        if (typeof el.x !== 'number' || typeof el.y !== 'number') {
          warnings.push(`Elemento "${el.id}": posición (x,y) no numérica`);
        }
      });
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
