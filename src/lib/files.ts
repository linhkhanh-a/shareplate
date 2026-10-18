import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Hands a file to the person: on iPhone and iPad, the share sheet (Save to
 * Files, Mail, Messages, Numbers…). The web version downloads it instead.
 */
export async function deliverFile(name: string, contents: Uint8Array | string, mimeType: string, uti?: string) {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(contents);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: name });
}

/** Shares an image that's already saved on the device (from a screenshot of the summary card). */
export async function deliverImage(uri: string, name: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: name });
}
