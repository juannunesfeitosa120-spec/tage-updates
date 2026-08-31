import { supabase } from '@/lib/supabase';

export const AVATAR_BUCKET = 'taggi-avatars';
export const PLATFORM_LOGO_BUCKET = 'taggi-platform-logos';

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

async function optimizeImage(file: File, maxDimension: number) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Use uma imagem JPG, PNG ou WebP.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('A imagem deve ter no máximo 5 MB.');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Não foi possível preparar a imagem.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const optimized = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', 0.86);
  });
  if (!optimized) throw new Error('Não foi possível preparar a imagem.');
  return optimized;
}

export async function uploadPrivateImage({
  bucket,
  folder,
  file,
  kind,
  maxDimension,
}: {
  bucket: string;
  folder: string;
  file: File;
  kind: 'avatar' | 'logo';
  maxDimension: number;
}) {
  if (!supabase) throw new Error('A conexão do Tage não está disponível.');
  const body = await optimizeImage(file, maxDimension);
  const path = folder + '/' + kind + '-' + Date.now() + '-' + crypto.randomUUID() + '.webp';
  const result = await supabase.storage.from(bucket).upload(path, body, {
    cacheControl: '31536000',
    contentType: 'image/webp',
    upsert: false,
  });
  if (result.error) throw result.error;
  return path;
}

export async function createSignedImageUrl(bucket: string, path: string | null | undefined) {
  if (!supabase || !path) return '';
  const result = await supabase.storage.from(bucket).createSignedUrl(path, 6 * 60 * 60);
  if (result.error) return '';
  return result.data.signedUrl;
}

export async function removePrivateImage(bucket: string, path: string | null | undefined) {
  if (!supabase || !path) return;
  await supabase.storage.from(bucket).remove([path]);
}
