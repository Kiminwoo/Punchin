import type { z } from 'zod';
import type { locationSchema, Office } from '@punchin/contracts';
import { ApiError } from './security';
export function distanceMeters(a: number, b: number, x: number, y: number) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const lat = rad(x - a),
    lon = rad(y - b);
  const value =
    Math.sin(lat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(x)) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}
export function verifyLocation(
  office: Office,
  location: z.infer<typeof locationSchema> | undefined,
  now: Date,
) {
  if (!office.enabled)
    return { verification: 'not_configured', evidence: { officeRevision: office.revision } };
  if (!location)
    throw new ApiError(
      400,
      '출퇴근 위치를 확인해 주세요. 위치 권한을 허용하거나 외근·정정을 신청해 주세요.',
    );
  const age = now.getTime() - Date.parse(location.capturedAt);
  if (age > 60000 || age < -5000)
    throw new ApiError(
      400,
      '위치 측정값이 오래되었거나 시각이 잘못되었습니다. 다시 측정해 주세요.',
    );
  if (location.accuracy > 100)
    throw new ApiError(400, '위치 오차가 큽니다. 재측정하거나 기록 정정을 신청해 주세요.');
  const distance = distanceMeters(
    office.latitude!,
    office.longitude!,
    location.latitude,
    location.longitude,
  );
  if (distance - location.accuracy > office.radius)
    throw new ApiError(403, '등록된 근무지 밖입니다. 외근·정정 신청을 이용해 주세요.');
  if (distance + location.accuracy > office.radius)
    throw new ApiError(
      400,
      '근무지 경계에서 위치가 불명확합니다. 재측정하거나 정정을 신청해 주세요.',
    );
  return {
    verification: 'gps_checked',
    evidence: {
      officeRevision: office.revision,
      distanceMeters: Math.round(distance),
      accuracyMeters: Math.round(location.accuracy),
    },
  };
}
