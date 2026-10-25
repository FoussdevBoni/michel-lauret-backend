import { Etablissement } from '../models/Etablissement';
import { etablissementService, serializeEtablissement } from './etablissementService';
import { createModuleSyncService } from './createModuleSyncService';

export const etablissementSyncService = createModuleSyncService({
  entity: 'etablissement',
  singletonKey: 'school',
  model: Etablissement,
  serialize: serializeEtablissement,
  canRestore: () => true,
  save: (data, _id, version = 0) => etablissementService.save({ ...data, version }),
  async remove() {
    const current = await Etablissement.findOne({ key: 'school' });
    if (current && !current.isDeleted)
      await etablissementService.delete({ version: current.__v });
  },
});
