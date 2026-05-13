import { useEffect, useState } from 'react';
import { getAppInfo, type AppInfo } from '../../ipc/settings';
import { SettingsHeading, SettingsSubtitle, SettingsCard } from './primitives';

export function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    getAppInfo().then(setInfo).catch(() => undefined);
  }, []);

  const rows: Array<[string, string]> = [
    ['Version', info?.version ?? '…'],
    ['Platform', info ? `${info.target_os} / ${info.target_arch}` : '…'],
    ['Build', info?.debug ? 'debug' : 'release'],
  ];

  return (
    <section>
      <SettingsHeading>About Atlas</SettingsHeading>
      <SettingsSubtitle>
        A voice-first desktop assistant. Built on ElevenLabs (Conversational Agent + Scribe
        v2 + Flash v2 + Instant Voice Clone) and Claude.
      </SettingsSubtitle>

      <SettingsCard>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', rowGap: 12, columnGap: 32 }}>
          {rows.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </dl>
      </SettingsCard>

      <p
        className="serif-body"
        style={{
          marginTop: 32,
          fontSize: 12,
          lineHeight: 1.6,
          color: 'var(--cream-faint)',
          maxWidth: 540,
          fontStyle: 'italic',
        }}
      >
        ATLAS is the dev-time working name. The public name will change before public launch
        (ADR 0001). The accessibility-first wedge is the lead positioning (ADR 0002).
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--cream-mute)',
          alignSelf: 'center',
        }}
      >
        {label}
      </dt>
      <dd
        className="mono"
        style={{
          margin: 0,
          fontSize: 13,
          color: 'var(--cream)',
        }}
      >
        {value}
      </dd>
    </>
  );
}
