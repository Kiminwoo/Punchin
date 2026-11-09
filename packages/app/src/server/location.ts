import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
export async function captureLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}> {
  if (Capacitor.isNativePlatform()) {
    const permissions = await Geolocation.checkPermissions();
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted')
      await Geolocation.requestPermissions({ permissions: ['location'] });
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
      };
    } catch {
      throw new Error(
        '위치를 확인하지 못했습니다. 위치 권한을 허용하거나 외근·정정을 신청해 주세요.',
      );
    }
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 기기는 위치 확인을 지원하지 않습니다. 외근·정정 신청을 이용해 주세요.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      (error) =>
        reject(
          new Error(
            error.code === 1
              ? '위치 권한이 거부되었습니다. 권한을 허용하거나 외근·정정을 신청해 주세요.'
              : '위치를 측정하지 못했습니다. 재측정하거나 정정을 신청해 주세요.',
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}
