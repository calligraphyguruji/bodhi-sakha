// Shared browser/server limits. A chunk stays comfortably below Vercel's JSON limit.
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const IMAGE_CHUNK_SIZE = 1024 * 1024;
export const MAX_IMAGES = 3;
export const IMAGE_SIZE_ERROR = 'Image size exceeds 5 MB. Please upload an image smaller than 5 MB.';
export const isImageFile = (name = '', type = '') => /\.(png|jpe?g|webp)$/i.test(name) || type.startsWith('image/');
