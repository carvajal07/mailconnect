import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Biblioteca de imágenes del cliente (POST /Resources/List).
 *
 * Lista lo que ya se subió al prefijo PÚBLICO `resources/` del bucket del tenant, para
 * poder reutilizarlo en vez de volver a subir el mismo logo en cada plantilla. El tenant
 * sale del token, no del body: no hay forma de listar el material de otra empresa.
 */

export const RESOURCES_ENDPOINTS = {
  LIST: '/Resources/List',
};

export interface StoredImage {
  key: string;
  url: string;
  name: string;
  size: number;
  modified: string;
}

export const resourcesService = {
  list: (prefix = 'resources/', limit?: number): Promise<ApiResponse<{ images: StoredImage[]; count: number; truncated: boolean }>> =>
    apiPost(RESOURCES_ENDPOINTS.LIST, { prefix, limit }),
};
