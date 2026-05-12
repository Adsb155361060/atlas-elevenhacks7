import { useOnboarding } from '../../state/onboarding';
import { Welcome } from './Welcome';
import { VoicePicker } from './VoicePicker';
import { Privacy } from './Privacy';
import { Done } from './Done';

export function Onboarding() {
  const step = useOnboarding((s) => s.step);
  switch (step) {
    case 'welcome':
      return <Welcome />;
    case 'voice':
      return <VoicePicker />;
    case 'privacy':
      return <Privacy />;
    case 'done':
      return <Done />;
  }
}
