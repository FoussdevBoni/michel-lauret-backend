import { z } from 'zod';
import { schoolYearSchema } from './Periode';

export const MAX_SCHOOL_IMAGE_BYTES = 128 * 1024;
export function isSchoolImage(value: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (
    !match ||
    match[2].length % 4 !== 0 ||
    match[2].length > Math.ceil(MAX_SCHOOL_IMAGE_BYTES / 3) * 4
  )
    return false;
  try {
    const bytes = atob(match[2]);
    if (
      bytes.length < 12 ||
      bytes.length > MAX_SCHOOL_IMAGE_BYTES ||
      btoa(bytes) !== match[2]
    )
      return false;
    if (match[1] === 'png') return bytes.slice(0, 8) === '\x89PNG\r\n\x1a\n';
    if (match[1] === 'jpeg')
      return (
        bytes.charCodeAt(0) === 255 &&
        bytes.charCodeAt(1) === 216 &&
        bytes.charCodeAt(2) === 255
      );
    return bytes.slice(0, 4) === 'RIFF' && bytes.slice(8, 12) === 'WEBP';
  } catch {
    return false;
  }
}
export const schoolImageSchema = z
  .string()
  .max(180000)
  .refine(isSchoolImage, 'Image PNG, JPEG ou WebP invalide ou supérieure à 128 Ko.');
const text = (max = 200) => z.string().trim().max(max).default('');
export const etablissementFields = z
  .object({
    nom: z.string().trim().min(1, 'Le nom est obligatoire.').max(200),
    adresse: z.string().trim().min(1, 'L’adresse est obligatoire.').max(500),
    telephone: z.string().trim().min(1, 'Le téléphone est obligatoire.').max(50),
    email: z.string().trim().toLowerCase().email('Adresse email invalide.').max(254),
    siteWeb: z
      .union([
        z.literal(''),
        z
          .string()
          .trim()
          .max(300)
          .url()
          .refine(
            (value) => /^https?:\/\//i.test(value),
            'Utilisez une adresse http ou https.',
          ),
      ])
      .default(''),
    anneeScolaire: schoolYearSchema,
    pays: text(),
    tutelle: text(),
    directionDepartementale: text(),
    servicePedagogique: text(),
    devise: text(),
    codeEtablissement: text(100),
    autorisation: text(),
    nomDirecteur: text(),
    fonctionSignataire: text(100),
    mentionPiedPage: text(1000),
    logo: schoolImageSchema.nullable().default(null),
    enTeteCarte: schoolImageSchema.nullable().default(null),
  })
  .strict();
export const etablissementSaveSchema = etablissementFields.extend({
  version: z.number().int().nonnegative(),
});
export const etablissementPatchSchema = etablissementFields
  .partial()
  .extend({ version: z.number().int().nonnegative() });
export type EtablissementInput = z.infer<typeof etablissementFields>;
export interface Etablissement extends EtablissementInput {
  id: string;
  version: number;
  localRevision?: number;
  isDeleted: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export const etablissementImageKeySchema = z.enum(['logo', 'enTeteCarte']);
export type EtablissementImageKey = z.infer<typeof etablissementImageKeySchema>;
