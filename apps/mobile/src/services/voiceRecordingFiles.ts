import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { RecordedVoice } from '../lib/voice';

/** Transfer ownership before the recorder clears its temporary file. */
export async function keepVoiceRecording(recording: RecordedVoice): Promise<RecordedVoice> {
  if (Platform.OS === 'web') {
    const source = await fetch(recording.uri);
    return { ...recording, uri: URL.createObjectURL(await source.blob()) };
  }
  const directory = new Directory(Paths.document, 'voice-outbox');
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, recording.requestId + '.m4a');
  if (!file.exists) await new File(recording.uri).copy(file);
  return { ...recording, uri: file.uri };
}

export async function removeVoiceRecording(uri: string): Promise<void> {
  try {
    if (Platform.OS === 'web') URL.revokeObjectURL(uri);
    else await new File(uri).delete();
  } catch { /* A cleared local file must not undo an acknowledged send. */ }
}
