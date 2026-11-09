import { useState } from 'react';
import { Badge, Button, Card } from '@punchin/ui';
import type { Office } from '@punchin/contracts';
import { Modal } from '../components/Primitives';
export function Settings({
  onReset,
  live = false,
  office,
}: {
  onReset: () => void;
  live?: boolean;
  office?: Office;
}) {
  const [reset, setReset] = useState(false);
  return (
    <div className="settings-layout">
      <Card>
        <div className="section-heading">
          <div>
            <h2>우리 회사의 근무 기준</h2>
            <p>확정된 정책을 기준으로 화면을 구성했어요.</p>
          </div>
          <Badge tone="green">기본 정책</Badge>
        </div>
        <div className="settings-rows">
          {[
            ['근무지', office?.address ?? '가산 오피스 · 단일 사업장'],
            ['출근 기준', '오전 08:00부터 자유 출근'],
            ['일일 목표', '실근무 8시간'],
            ['점심 휴게', '11:30 – 13:00 · 겹치는 구간만 제외'],
            ['퇴근 기록', '8시간 미만·초과 모두 실제 시각 보존'],
            [
              '위치 인증',
              live
                ? office?.enabled
                  ? 'GPS 사용 · 실제 기기 검증 필요'
                  : '좌표 확인 전 · 위치 미검증'
                : '미연결 · 실기기 검증 후 도입',
            ],
            ['근무 중 위치 추적', '사용하지 않음'],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="section-heading">
          <div>
            <h2>{live ? '서버 연결 정보' : '시연 데이터 관리'}</h2>
            <p>
              {live
                ? '직원·관리자 화면이 같은 서버 기록을 조회합니다.'
                : '현재 데이터는 이 브라우저에서만 유지됩니다.'}
            </p>
          </div>
        </div>
        <div className="settings-description">
          <p>
            {live
              ? '로그인·초대·서버 시각 기록·정정 원본 보존이 연결되었습니다. 휴가 잔액과 월별 마감은 아직 제공하지 않습니다. 위치 인증은 사무실 설정에 따릅니다. 퇴사자 접근 차단은 관리자 우리 팀 화면에서 처리합니다.'
              : '가상 직원과 예제 기록을 사용합니다. 직원 앱과 관리자 웹은 독립된 시연이며, 서버·로그인·GPS·잔여 연차 계산·근태 마감은 아직 연결되지 않았습니다.'}
          </p>
          {!live && (
            <Button variant="secondary" onClick={() => setReset(true)}>
              시연 데이터 초기화
            </Button>
          )}
        </div>
      </Card>
      {reset && (
        <Modal
          title="시연 데이터를 초기화할까요?"
          subtitle="이 브라우저에서 추가한 요청과 출퇴근 시연 기록이 초기화됩니다."
          onClose={() => setReset(false)}
        >
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setReset(false)}>
              취소
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onReset();
                setReset(false);
              }}
            >
              초기화
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
