import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/** Longest side of a receipt photo after shrinking. Plenty for reading small print. */
const MAX_SIDE = 1600;

/**
 * Lets the person take or choose a receipt photo, then shrinks it to a sensible
 * size and JPEG so uploads are quick. Returns null if they cancel.
 */
export async function pickReceiptPhoto(source: 'camera' | 'library'): Promise<{ uri: string } | null> {
  const useCamera = source === 'camera' && Platform.OS !== 'web';
  if (useCamera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Camera access is turned off for Shareplate. Turn it on in Settings, or choose a photo instead.');
    }
  }
  // On the web, the file chooser offers the camera on phones by itself.
  const result = useCamera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  const { width = 0, height = 0 } = asset;
  if (width > MAX_SIDE || height > MAX_SIDE) {
    context.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return { uri: saved.uri };
}
