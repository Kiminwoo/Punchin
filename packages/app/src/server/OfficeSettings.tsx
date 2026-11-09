import { useState } from 'react';
import type { FormEvent } from 'react';
import { MapPin } from 'lucide-react';
import { Badge, Button, Card } from '@punchin/ui';
import { captureLocation } from './location';
import type { LiveRuntime } from './LiveApplication';
export function OfficeSettings({ runtime }: { runtime: LiveRuntime }) {
  const office = runtime.snapshot.office;
  const [latitude, setLatitude] = useState(office.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(office.longitude?.toString() ?? '');
  const [radius, setRadius] = useState(office.radius.toString());
  const [confirmed, setConfirmed] = useState(office.confirmed);
  const [enabled, setEnabled] = useState(office.enabled);
  const [message, setMessage] = useState('');
  const [measuring, setMeasuring] = useState(false);
  async function measure() {
    setMeasuring(true);
    setMessage('');
    try {
      const location = await captureLocation();
      setLatitude(location.latitude.toFixed(7));
      setLongitude(location.longitude.toFixed(7));
      setConfirmed(false);
      setMessage(
        `측정 오차 약 ${Math.round(location.accuracy)}m입니다. 사무실 현장에서 측정한 좌표인지 확인해 주세요.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '측정에 실패했습니다.');
    } finally {
      setMeasuring(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage('');
    try {
      await runtime.mutate(
        '/admin/office',
        {
          name: office.name,
          address: office.address,
          latitude: latitude === '' ? null : Number(latitude),
          longitude: longitude === '' ? null : Number(longitude),
          radius: Number(radius),
          enabled,
          confirmed,
        },
        'PATCH',
      );
      setMessage(
        '근무지 설정을 서버에 저장했습니다. 실제 Android·iPhone에서 반경을 검증해 주세요.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '저장하지 못했습니다.');
    }
  }
  return (
    <Card className="office-settings">
      <div className="section-heading">
        <div>
          <h2>사무실 위치 인증</h2>
          <p>{office.address}</p>
        </div>
        <Badge tone={office.enabled ? 'green' : 'orange'}>
          {office.enabled ? 'GPS 사용' : '현장 검증 대기'}
        </Badge>
      </div>
      <form className="request-form" onSubmit={submit}>
        <p className="form-note">
          좌표를 추정해 자동 적용하지 않습니다. 실제 사무실에서 측정하거나 확인한 좌표를 입력하세요.
          GPS는 7층 출입 여부를 확인하지 못합니다.
        </p>
        <div className="form-date-row">
          <label>
            위도
            <input
              type="number"
              step="any"
              min={-90}
              max={90}
              value={latitude}
              onChange={(e) => {
                setLatitude(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <label>
            경도
            <input
              type="number"
              step="any"
              min={-180}
              max={180}
              value={longitude}
              onChange={(e) => {
                setLongitude(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={measuring || runtime.busy}
          onClick={() => void measure()}
        >
          <MapPin size={15} />
          {measuring ? '위치 측정 중' : '현재 위치를 후보 좌표로 측정'}
        </Button>
        <label>
          인증 반경 (m)
          <input
            type="number"
            min={50}
            max={500}
            required
            value={radius}
            onChange={(e) => {
              setRadius(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          실제 사무실에서 좌표와 반경을 확인했습니다.
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          출퇴근 시 위치 확인을 사용합니다.
        </label>
        {message && (
          <p className="form-note" role="status">
            {message}
          </p>
        )}
        <Button type="submit" disabled={runtime.busy || measuring}>
          근무지 설정 저장
        </Button>
        <p className="demo-form-note">
          출퇴근 시점에만 위치를 확인합니다. 개인 정밀 좌표는 DB에 보관하지 않고 거리·오차·판정
          결과를 저장합니다. 위치 조작을 완전히 방지하는 기능은 아닙니다.
        </p>
      </form>
    </Card>
  );
}
