import { useT } from '../../app/runtime';
import { AboutSection } from './AboutSection';
import { AthleteSection } from './AthleteSection';
import { ResultSection, SplitsSection } from './ResultSection';
import { RouteSection } from './RouteSection';
import { SessionSection } from './SessionSection';

export function ProtocolSheet() {
  const t = useT();
  return (
    <div className="sheet" aria-label={`${t('sectionRoute')}, ${t('sectionAthlete')}, ${t('sectionSession')}`} role="region">
      <RouteSection />
      <AthleteSection />
      <SessionSection />
      <ResultSection />
      <SplitsSection />
      <AboutSection />
    </div>
  );
}
