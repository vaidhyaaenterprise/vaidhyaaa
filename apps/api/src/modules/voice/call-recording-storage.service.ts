import { Inject, Injectable } from '@nestjs/common';

import {
  ADAPTER_TOKENS,
  type CallRecordingMetadataInput,
  type CallRecordingMetadataResult,
  type CallRecordingStorage,
  type ObjectStorageProvider,
} from '@vaidya/shared';

@Injectable()
export class CallRecordingStorageService implements CallRecordingStorage {
  constructor(
    @Inject(ADAPTER_TOKENS.ObjectStorageProvider)
    private readonly objectStorage: ObjectStorageProvider,
  ) {}

  async storeRecordingMetadata(input: CallRecordingMetadataInput): Promise<CallRecordingMetadataResult> {
    const key = input.storageKey.startsWith('recordings/')
      ? input.storageKey
      : `recordings/${input.clinicId}/${input.callId}/${input.storageKey}`;

    await this.objectStorage.put({
      key,
      body: Buffer.from(''),
      contentType: input.contentType,
    });

    const recordingUrl = await this.objectStorage.getSignedUrl(key, 3600);
    return { storageKey: key, recordingUrl };
  }
}
