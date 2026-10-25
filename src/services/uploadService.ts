import { createHash } from 'node:crypto';
import { getSupabase } from '../lib/supabase';
import { HttpError } from '../utils/HttpError';
import { MAX_SCHOOL_IMAGE_BYTES } from '../types/features/Etablissement';

export const uploadService = {
  bucket() {
    return process.env.SUPABASE_MEDIA_BUCKET || 'cpeg-media-private';
  },
  async ensureBucket() {
    const storage = getSupabase().storage;
    const name = uploadService.bucket();
    let result = await storage.getBucket(name);
    if (result.error && ['404', '400'].includes(String(result.error.status))) {
      const created = await storage.createBucket(name, {
        public: false,
        fileSizeLimit: MAX_SCHOOL_IMAGE_BYTES,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      });
      if (created.error && !['409', '400'].includes(String(created.error.status)))
        throw new HttpError(503, 'Impossible de préparer le stockage privé.');
      result = await storage.getBucket(name);
    }
    if (result.error || !result.data)
      throw new HttpError(503, 'Le stockage des images est indisponible.');
    if (result.data.public)
      throw new HttpError(503, 'Le bucket des images doit être privé.');
  },
  async put(key: string, bytes: Buffer, mime: string, sha256: string) {
    await uploadService.ensureBucket();
    const bucket = getSupabase().storage.from(uploadService.bucket());
    const { error } = await bucket.upload(key, bytes, {
      upsert: false,
      contentType: mime,
      cacheControl: '0',
    });
    if (!error) return;
    // Une réponse perdue ne doit créer ni doublon ni écrasement d'objet.
    if (['409', '400'].includes(String(error.statusCode ?? error.status))) {
      const existing = await bucket.download(key);
      if (
        !existing.error &&
        existing.data &&
        createHash('sha256')
          .update(Buffer.from(await existing.data.arrayBuffer()))
          .digest('hex') === sha256
      )
        return;
    }
    throw new HttpError(503, 'Envoi interrompu. Le fichier sera réessayé.');
  },
  async download(key: string) {
    const { data, error } = await getSupabase()
      .storage.from(uploadService.bucket())
      .download(key);
    if (error || !data) throw new HttpError(503, 'Image temporairement indisponible.');
    return Buffer.from(await data.arrayBuffer());
  },
  async delete(key: string) {
    const { error } = await getSupabase()
      .storage.from(uploadService.bucket())
      .remove([key]);
    if (error) throw new HttpError(503, 'La suppression du fichier doit être réessayée.');
  },
};
