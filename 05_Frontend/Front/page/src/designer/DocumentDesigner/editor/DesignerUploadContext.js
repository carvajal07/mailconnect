// DesignerUploadContext.js
// Inyecta una "API de assets" opcional al DocumentDesigner. Cuando el editor se usa para
// templates (TemplateDesigner), el wrapper provee un objeto:
//   { upload(file, kind) => Promise<AssetView>, list(params) => Promise<AssetView[]> }
// que habla con el backend. Cuando se usa como nodo del workflow, no hay provider →
// undefined → el editor cae al comportamiento de siempre (data URL embebido, sin picker).
import { createContext, useContext } from 'react';

export const DesignerAssetsContext = createContext(null);

/** @returns {undefined | { upload: Function, list: Function }} */
export function useDesignerAssets() {
  return useContext(DesignerAssetsContext);
}
