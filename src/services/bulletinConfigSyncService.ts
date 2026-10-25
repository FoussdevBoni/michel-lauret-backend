import { ConfigBulletin } from '../models/ConfigBulletin';
import { bulletinConfigService } from './bulletinConfigService';
import { createModuleSyncService } from './createModuleSyncService';

export const bulletinConfigSyncService = createModuleSyncService({
  entity: 'bulletinConfig',
  singletonKey: 'default',
  model: ConfigBulletin,
  serialize: (record) => ({ id: 'default', config: record.config, version: record.__v }),
  async save(data, _id, version = 0) {
    await bulletinConfigService.saveConfig({ ...data, version });
    return { id: 'default' };
  },
  async remove() {
    const current = await bulletinConfigService.getConfig();
    await bulletinConfigService.deleteConfig({ version: current.version });
  },
});
