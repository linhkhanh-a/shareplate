/**
 * Web version: browsers can't open a share sheet for a file reliably, so files
 * download (on a phone browser, they land in Downloads or the Files app).
 */
export async function deliverFile(name: string, contents: Uint8Array | string, mimeType: string, _uti?: string) {
  const part: BlobPart = typeof contents === 'string' ? contents : (contents as Uint8Array<ArrayBuffer>);
  const url = URL.createObjectURL(new Blob([part], { type: mimeType }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** On the web the "uri" is a data: URL from the screenshot. Phones that can share files get the share sheet. */
export async function deliverImage(uri: string, name: string) {
  const blob = await (await fetch(uri)).blob();
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // Fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
