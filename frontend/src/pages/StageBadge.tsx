import type { Stage } from '../api';
import { stageLabel } from '../format';

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge stage-${stage}`}>{stageLabel(stage)}</span>;
}
