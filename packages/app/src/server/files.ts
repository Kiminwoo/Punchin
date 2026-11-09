import { Capacitor } from '@capacitor/core';
export async function saveCsv(csv: string, filename: string) {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const path = `punchin-${crypto.randomUUID()}.csv`;
    const file = await Filesystem.writeFile({
      path,
      data: csv,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({
        title: 'Punchin 근태 기록',
        files: [file.uri],
        dialogTitle: '근태 기록 내보내기',
      });
    } finally {
      await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
